"""Compile the real Qt transport and exercise it over local TCP, without the DJ engine."""
from pathlib import Path
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = r'''
#include "mixer/livemetadataserver.h"
#include <QCoreApplication>
#include <QElapsedTimer>
#include <QThread>
#include <cassert>
#include <iostream>
#include <memory>
#include <vector>
void pump(int ms=50) {
    QElapsedTimer timer; timer.start();
    while (timer.elapsed()<ms) { QCoreApplication::processEvents(); QThread::msleep(1); }
}
int main(int argc,char** argv) {
    QCoreApplication app(argc,argv);
    int calls=0, revision=1;
    LiveMetadataServer server([&]{++calls; return QJsonObject{{"revision",revision}};});
    assert(server.start(QHostAddress::LocalHost,0));
    const auto port=server.port();
    QTcpServer collision; assert(!collision.listen(QHostAddress::LocalHost,port));
    pump(150); assert(calls==0); // no polling
    QTcpSocket snapshot;
    snapshot.connectToHost(QHostAddress::LocalHost,port); pump();
    snapshot.write("GET /v1/state HTTP/1.1\r\nHost: localhost\r\n\r\n"); pump();
    auto response=snapshot.readAll();
    assert(response.startsWith("HTTP/1.1 200")); assert(response.contains("\"revision\":1"));
    assert(calls==1);
    QTcpSocket events;
    events.connectToHost(QHostAddress::LocalHost,port); pump();
    events.write("GET /v1/events HTTP/1.1\r\nHost: localhost\r\n\r\n"); pump();
    assert(events.readAll().contains("event: state")); assert(calls==2);
    ++revision;
    for(int i=0;i<100;++i) server.changed();
    pump(180); assert(calls==3);
    response=events.readAll(); assert(response.count("event: state")==1);
    assert(response.contains("\"revision\":2"));
    pump(200); assert(calls==3);
    QTcpSocket bad;
    bad.connectToHost(QHostAddress::LocalHost,port); pump();
    bad.write("POST /v1/state HTTP/1.1\r\nHost: localhost\r\n\r\n"); pump();
    assert(bad.readAll().startsWith("HTTP/1.1 404")); assert(calls==3);
    QTcpSocket oversized;
    oversized.connectToHost(QHostAddress::LocalHost,port); pump();
    oversized.write(QByteArray(9000,'x')); pump();
    assert(oversized.state()==QAbstractSocket::UnconnectedState);
    server.stop(); pump(); assert(events.state()==QAbstractSocket::UnconnectedState);
    server.changed(); pump(200); assert(calls==3);
    assert(server.start(QHostAddress::LocalHost,port));
    std::vector<std::unique_ptr<QTcpSocket>> clients;
    for(int i=0;i<8;++i) {
        auto socket=std::make_unique<QTcpSocket>();
        socket->connectToHost(QHostAddress::LocalHost,port); pump();
        assert(socket->state()==QAbstractSocket::ConnectedState);
        clients.push_back(std::move(socket));
    }
    QTcpSocket excess; excess.connectToHost(QHostAddress::LocalHost,port); pump();
    assert(excess.state()==QAbstractSocket::UnconnectedState);
    pump(5300); // incomplete requests time out and release every slot
    for(const auto& socket:clients) assert(socket->state()==QAbstractSocket::UnconnectedState);
    assert(calls==3);
    server.stop();
    std::cout << "metadata TCP/SSE: snapshot, initial event, coalescing, idle, invalid method, size limit, stop/rebind, connection cap and timeout PASS\n";
}
'''
with tempfile.TemporaryDirectory(prefix='piflex-metadata-') as directory:
    fixture = Path(directory) / 'test.cpp'
    binary = Path(directory) / 'test'
    fixture.write_text(SOURCE)
    flags = shlex.split(subprocess.check_output(
        ['pkg-config','--cflags','--libs','Qt6Network'], text=True))
    subprocess.run(['c++','-std=c++20','-fPIC','-I'+str(ROOT/'src'),str(fixture),
                    str(ROOT/'src/mixer/livemetadataserver.cpp'),'-o',str(binary),*flags],check=True)
    subprocess.run([str(binary)],check=True,timeout=15)
