#include "mixer/livemetadataserver.h"

#include <QJsonDocument>

LiveMetadataServer::LiveMetadataServer(std::function<QJsonObject()> snapshot, QObject* parent)
        : QObject(parent), m_snapshot(std::move(snapshot)) {
    m_server.setMaxPendingConnections(8);
    m_publishTimer.setSingleShot(true);
    m_publishTimer.setInterval(100);
    m_heartbeat.setInterval(15000);
    connect(&m_server, &QTcpServer::newConnection, this, [this] { acceptClients(); });
    connect(&m_publishTimer, &QTimer::timeout, this, [this] { publish(); });
    connect(&m_heartbeat, &QTimer::timeout, this, [this] {
        const auto subscribers = m_subscribers;
        for (auto* client : subscribers) {
            if (client->bytesToWrite() > 65536) { client->disconnectFromHost(); }
            else { client->write(": keepalive\n\n"); }
        }
    });
}

bool LiveMetadataServer::start(const QHostAddress& address, quint16 port) {
    stop();
    return m_server.listen(address, port);
}

void LiveMetadataServer::stop() {
    m_server.close();
    m_publishTimer.stop();
    m_heartbeat.stop();
    const auto clients = m_clients;
    for (auto* client : clients) {
        disconnect(client, nullptr, this, nullptr);
        client->abort();
        client->deleteLater();
    }
    m_clients.clear();
    m_subscribers.clear();
}

void LiveMetadataServer::changed() {
    if (!m_subscribers.isEmpty() && !m_publishTimer.isActive()) {
        m_publishTimer.start();
    }
}

void LiveMetadataServer::sendEvent(QTcpSocket* client, const QByteArray& payload) {
    if (client->bytesToWrite() > 65536) { client->disconnectFromHost(); return; }
    client->write("event: state\ndata: " + payload + "\n\n");
}

void LiveMetadataServer::publish() {
    if (m_subscribers.isEmpty()) { return; }
    const auto data = QJsonDocument(m_snapshot()).toJson(QJsonDocument::Compact);
    const auto subscribers = m_subscribers;
    for (auto* client : subscribers) { sendEvent(client, data); }
}

void LiveMetadataServer::acceptClients() {
    while (auto* client = m_server.nextPendingConnection()) {
        if (m_clients.size() >= 8) { client->abort(); client->deleteLater(); continue; }
        m_clients.insert(client);
        client->setReadBufferSize(8193);
        auto* timeout = new QTimer(client);
        timeout->setSingleShot(true);
        connect(timeout, &QTimer::timeout, client, &QTcpSocket::abort);
        timeout->start(5000);
        connect(client, &QTcpSocket::disconnected, this, [this, client] {
            m_clients.remove(client);
            m_subscribers.remove(client);
            if (m_subscribers.isEmpty()) { m_heartbeat.stop(); m_publishTimer.stop(); }
            client->deleteLater();
        });
        connect(client, &QTcpSocket::readyRead, this, [this, client, timeout] {
            if (m_subscribers.contains(client)) { client->abort(); return; }
            if (client->bytesAvailable() > 8192) { client->abort(); return; }
            const auto request = client->peek(8192);
            if (!request.contains("\r\n\r\n")) { return; }
            client->readAll();
            timeout->stop();
            const auto firstLine = request.left(request.indexOf("\r\n"));
            const auto parts = firstLine.split(' ');
            const bool get = parts.size() == 3 && parts[0] == "GET" &&
                    (parts[2] == "HTTP/1.0" || parts[2] == "HTTP/1.1");
            const auto path = get ? parts[1] : QByteArray();
            if (path == "/v1/events") {
                client->write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                              "Cache-Control: no-store\r\nConnection: keep-alive\r\n\r\n");
                m_subscribers.insert(client);
                m_heartbeat.start();
                sendEvent(client, QJsonDocument(m_snapshot()).toJson(QJsonDocument::Compact));
                return;
            }
            const bool valid = path == "/v1/state";
            const auto data = valid ? QJsonDocument(m_snapshot()).toJson(QJsonDocument::Compact)
                                    : QByteArray("{\"error\":\"not_found\"}");
            client->write(QByteArray(valid ? "HTTP/1.1 200 OK\r\n" : "HTTP/1.1 404 Not Found\r\n") +
                    "Content-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: " +
                    QByteArray::number(data.size()) + "\r\n\r\n" + data);
            client->disconnectFromHost();
        });
    }
}
