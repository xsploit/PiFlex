#pragma once

#include <QJsonObject>
#include <QObject>
#include <QSet>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTimer>
#include <functional>

// Small read-only HTTP/SSE transport. All work runs in the owner's GUI/event
// thread, never in an audio callback. The provider is evaluated only on demand.
class LiveMetadataServer : public QObject {
  public:
    explicit LiveMetadataServer(std::function<QJsonObject()> snapshot, QObject* parent = nullptr);
    ~LiveMetadataServer() override { stop(); }
    bool start(const QHostAddress& address, quint16 port);
    void stop();
    void changed();
    quint16 port() const { return m_server.serverPort(); }
  private:
    void acceptClients();
    void publish();
    void sendEvent(QTcpSocket* client, const QByteArray& payload);
    std::function<QJsonObject()> m_snapshot;
    QTcpServer m_server;
    QSet<QTcpSocket*> m_clients;
    QSet<QTcpSocket*> m_subscribers;
    QTimer m_publishTimer;
    QTimer m_heartbeat;
};
