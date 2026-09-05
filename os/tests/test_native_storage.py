"""Compile and exercise the exact Qt storage/eject helpers without building the full DJ app."""
from pathlib import Path
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
def function(file, signature):
    text = (ROOT/file).read_text()
    start = text.index(signature)
    body = text.index('{', start)
    depth = 1
    cursor = body + 1
    while depth:
        if text[cursor] == '{': depth += 1
        if text[cursor] == '}': depth -= 1
        cursor += 1
    return text[start:cursor]

source = '''
#include <QCoreApplication>
#include <QDir>
#include <QEventLoop>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTimer>
#include <cassert>
'''
source += function('src/library/edmc/edmcfeature.cpp','QString downloadStorageRoot(')
source += function('src/preferences/systemsettings.cpp','bool coordinateEdmcEject(')
source += '''
int main(int argc, char** argv) {
    QCoreApplication app(argc,argv);
    QJsonObject storage{{"usbRoot","/media/B"},{"volumes",QJsonArray{
        QJsonObject{{"rootPath","/media/A"},{"id","uuid:A"},{"ejecting",false}},
        QJsonObject{{"rootPath","/media/B"},{"id","uuid:B"},{"ejecting",false}}}}};
    QJsonObject status{{"storage",storage}};
    QJsonObject track{{"storageRoot","/media/A"},{"storageId","uuid:A"}};
    assert(downloadStorageRoot(track,status)=="/media/A");
    track.insert("storageId","uuid:replacement");
    assert(downloadStorageRoot(track,status).isEmpty());
    assert(downloadStorageRoot({},status)=="/media/B");
    QTcpServer server;
    // Fail without contacting anything if a real service already owns the port.
    if (!server.listen(QHostAddress::LocalHost,17642)) return 77;
    bool ready=true;
    QObject::connect(&server,&QTcpServer::newConnection,&app,[&]() {
        auto* socket=server.nextPendingConnection();
        QObject::connect(socket,&QTcpSocket::readyRead,socket,[&,socket]() {
            socket->readAll();
            QByteArray body=ready ? "{\\"ready\\":true}" : "{\\"ready\\":false}";
            socket->write("HTTP/1.1 200 OK\\r\\nConnection: close\\r\\nContent-Length: "+QByteArray::number(body.size())+"\\r\\n\\r\\n"+body);
            socket->disconnectFromHost();
        });
        QObject::connect(socket,&QTcpSocket::disconnected,socket,&QObject::deleteLater);
    });
    QString error;
    assert(coordinateEdmcEject("/media/A",true,&error));
    ready=false;
    assert(!coordinateEdmcEject("/media/A",true,&error));
    assert(!error.isEmpty());
    ready=true;
    assert(coordinateEdmcEject("/media/A",false,&error));
}
'''
with tempfile.TemporaryDirectory(prefix='pflx-native-test-') as directory:
    source_path=Path(directory)/'test.cpp'; source_path.write_text(source)
    output=Path(directory)/'test'
    flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','Qt6Core','Qt6Network'],text=True))
    subprocess.run(['c++','-std=c++20','-fPIC',str(source_path),'-o',str(output),*flags],check=True)
    result=subprocess.run([str(output)],timeout=20)
    if result.returncode==77:
        raise SystemExit('Test port 17642 occupied; no endpoint was contacted')
    result.check_returncode()
    print('Qt storage identity and eject protocol tests passed (real source helpers).')
