"""Compile real page-chain guard and ANLZ pass selection/error handling.

The lower track-mutating readAnalyze operation is a recording test double;
inspect_rekordbox.py separately exercises the real generated file parsers.
"""
from pathlib import Path
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
text = (ROOT/'src/library/rekordbox/rekordboxfeature.cpp').read_text()
start = text.index('QStringList readAnalyzeFiles(')
end = text.index('\nvoid readAnalyze(', start)
source = r'''
#include <QCoreApplication>
#include <QFile>
#include <QFileInfo>
#include <QDebug>
#include <QTemporaryDir>
#include <QStringList>
#include <cassert>
#include "library/rekordbox/rekordboxpagechain.h"
using TrackPointer = int;
namespace mixxx::audio { using SampleRate = int; }
namespace mixxx::rekordbox {
QList<QPair<QString,bool>> calls;
bool corruptExt=false;
void readAnalyze(TrackPointer, audio::SampleRate, int, bool beats, const QString& path) {
    calls.append({path,beats});
    if (corruptExt && path.endsWith("EXT")) throw std::runtime_error("truncated fixture");
}
'''+text[start:end]+r'''
}
template<class F> void throws(F f) {
    bool caught=false; try { f(); } catch (const std::runtime_error&) { caught=true; }
    assert(caught);
}
int main(int argc, char** argv) {
    QCoreApplication app(argc,argv);
    using namespace mixxx::rekordbox;
    PageChainGuard guard(4096,4096ULL*70001);
    guard.visit(65536); guard.visit(70000); // no 16-bit truncation
    throws([&]{guard.visit(65536);}); // cycle
    throws([&]{guard.visit(70001);}); // past EOF
    throws([]{PageChainGuard invalid(0,4096);});
    throws([]{PageChainGuard invalid(4096,4095);});
    QTemporaryDir temp; assert(temp.isValid());
    const QString dat=temp.filePath("ANLZ.DAT"), ext=temp.filePath("ANLZ.EXT");
    QFile file(dat); assert(file.open(QIODevice::WriteOnly)); file.write("fixture"); file.close();
    assert(readAnalyzeFiles(0,44100,0,dat).isEmpty());
    assert(calls.size()==2 && calls[0]==qMakePair(dat,true) && calls[1]==qMakePair(dat,false));
    QFile extended(ext); assert(extended.open(QIODevice::WriteOnly)); extended.write("fixture"); extended.close();
    calls.clear();
    assert(readAnalyzeFiles(0,44100,0,dat).isEmpty());
    assert(calls.size()==2 && calls[0]==qMakePair(dat,true) && calls[1]==qMakePair(ext,false));
    corruptExt=true;
    auto failed=readAnalyzeFiles(0,44100,0,dat);
    assert(failed==QStringList{ext}); // caught, reported, not silently replaced with old cues
    QFile::remove(dat); QFile::remove(ext); calls.clear();
    failed=readAnalyzeFiles(0,44100,0,dat);
    assert(failed==QStringList{dat} && calls.isEmpty());
}
'''
with tempfile.TemporaryDirectory(prefix='pflx-rekordbox-safety-') as directory:
    cpp=Path(directory)/'test.cpp'; cpp.write_text(source)
    binary=Path(directory)/'test'
    flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','Qt6Core'],text=True))
    subprocess.run(['c++','-std=c++20','-fPIC','-I'+str(ROOT/'src'),str(cpp),'-o',str(binary),*flags],check=True)
    subprocess.run([str(binary)],check=True,timeout=10)
    print('Rekordbox 32-bit page bounds, cycle rejection, DAT/EXT routing and error reporting passed.')
