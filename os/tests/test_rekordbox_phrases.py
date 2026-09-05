"""Exercise the actual PSSI parser, timing adapter and offscreen phrase painter."""
from pathlib import Path
import os
import shlex
import subprocess
import tempfile
from native_test_support import fpclassify_object

ROOT = Path(__file__).resolve().parents[2]
feature = (ROOT/'src/library/rekordbox/rekordboxfeature.cpp').read_text()
importer = feature[feature.index('QString readPhrases('):feature.index('QString readThreeBandWaveforms(')]
source = r'''
#include <QGuiApplication>
#include <QImage>
#include <QFile>
#include <QFileInfo>
#include <QTemporaryDir>
#include <QDebug>
#include <cassert>
#include <fstream>
#include <limits>
#include "library/rekordbox/rekordboxphrases.h"
#include "waveform/renderers/phrasestrip.h"
using namespace mixxx;
using namespace mixxx::rekordbox;
struct TestTrack {
    PhraseList phrases;
    void setPhrases(PhraseList value) { phrases=std::move(value); }
    double getDuration() const { return 3; }
};
using TrackPointer=std::shared_ptr<TestTrack>;
namespace mixxx::rekordbox {
'''+importer+r'''
}
void u16(std::string& s,unsigned n) { s+=char(n>>8); s+=char(n); }
void u32(std::string& s,unsigned n) { u16(s,n>>16); u16(s,n); }
std::string fixture(int mood, int kind, int start=1, int end=4, int fill=0, bool masked=false) {
    std::string body;
    u16(body,mood); body+=std::string(6,0); u16(body,end); body+=std::string(4,0);
    u16(body,1); u16(body,start); u16(body,kind);
    body+=std::string(14,0); body+=char(0); body+=char(fill?1:0); u16(body,fill);
    if (masked) {
        const unsigned char mask[]={203,225,238,250,229,238,173,238,233,210,233,235,225,233,243,232,233,244,225};
        for (size_t i=0;i<body.size();++i) body[i]^=char(mask[i%19]+1);
    }
    std::string result; u32(result,24); u16(result,1); return result+body;
}
PhraseList decode(std::string bytes, std::vector<double> beats={100,600,1200,1900}, int offset=0, double duration=3) {
    kaitai::kstream stream(bytes);
    rekordbox_anlz_t::song_structure_tag_t tag(&stream);
    return decodePhrases(tag,beats,duration,offset);
}
template<class F> void rejects(F f) {
    bool failed=false; try {f();} catch(const std::exception&) {failed=true;} assert(failed);
}
std::string section(const std::string& name,const std::string& body) {
    std::string result=name; u32(result,12); u32(result,12+body.size()); return result+body;
}
std::string anlz(const std::string& sections) {
    std::string result="PMAI"; u32(result,28); u32(result,28+sections.size());
    return result+std::string(16,0)+sections;
}
void writeFile(const QString& path,const std::string& bytes) {
    QFile f(path); assert(f.open(QIODevice::WriteOnly));
    assert(f.write(bytes.data(),bytes.size())==qint64(bytes.size()));
}
int main(int argc,char** argv) {
    QGuiApplication app(argc,argv);
    const auto near=[](double a,double b){return std::abs(a-b)<1e-9;};
    auto plain=decode(fixture(2,9,1,4,3));
    assert(plain.size()==1 && plain[0].kind==Phrase::Kind::Chorus);
    assert(near(plain[0].startSeconds,0.1) && near(plain[0].endSeconds,1.9) && near(plain[0].fillSeconds,1.2));
    assert(plain==decode(fixture(2,9,1,4,3,true))); // masked and old unmasked exports
    assert(decode(fixture(1,2))[0].kind==Phrase::Kind::Up);
    assert(decode(fixture(3,7))[0].label=="Verse 2");
    assert(decode(fixture(2,7))[0].label=="Verse 6");
    assert(decode(fixture(2,99))[0].kind==Phrase::Kind::Unknown);
    auto shifted=decode(fixture(2,1),{100,600,1200,1900},50);
    assert(near(shifted[0].startSeconds,0.05) && near(shifted[0].endSeconds,1.85));
    assert(decode(fixture(2,1),{100,600,1200,1900},500)[0].startSeconds==0);
    assert(decode(fixture(2,1),{100,600,1200,1900},0,1)[0].endSeconds==1);
    rejects([]{decode(fixture(2,1,0));});
    rejects([]{decode(fixture(2,1,3,2));});
    rejects([]{decode(fixture(2,1,1,9));});
    assert(decode(fixture(2,1,1,4,5))[0].fillSeconds==-1);
    {
        kaitai::kstream s(fixture(2,1,1,5));
        rekordbox_anlz_t::song_structure_tag_t tag(&s);
        const auto boundary=decodePhrases(tag,{100,600,1200,1900},3,0,2400);
        assert(near(boundary[0].endSeconds,2.4));
        rejects([&]{decodePhrases(tag,{100,600,1200,1900},3,0);});
    }
    rejects([]{decode(fixture(2,1),{});});
    rejects([]{decode(fixture(2,1),{100,100,200,300});});
    rejects([]{decode(fixture(2,1),{100,600,1200,1900},0,std::numeric_limits<double>::quiet_NaN());});
    auto truncated=fixture(2,1); truncated.pop_back();
    rejects([&]{decode(truncated);});
    QImage image(200,60,QImage::Format_ARGB32); image.fill(Qt::black);
    const PhraseList strip={{0,1,-1,Phrase::Kind::Intro,"Intro"},
                           {1,2,-1,Phrase::Kind::Chorus,"Chorus"}};
    {
        QPainter p(&image);
        paintPhraseStrip(p,strip,image.rect(),Qt::Horizontal,0,2);
    }
    const auto blended=[](Phrase::Kind kind) {
        QImage pixel(1,1,QImage::Format_ARGB32); pixel.fill(Qt::black);
        QPainter p(&pixel); QColor color=phraseColor(kind);color.setAlphaF(0.75);
        p.fillRect(pixel.rect(),color);p.end();return pixel.pixelColor(0,0);
    };
    assert(image.pixelColor(25,58)==blended(Phrase::Kind::Intro));
    assert(image.pixelColor(150,58)==blended(Phrase::Kind::Chorus));
    assert(image.pixelColor(25,10)==QColor(Qt::black)); // rest of waveform untouched
    image.fill(Qt::black);
    { QPainter p(&image); paintPhraseStrip(p,{},image.rect(),Qt::Horizontal,0,2); }
    assert(image.pixelColor(25,58)==QColor(Qt::black)); // no stale lane on next track
    QImage vertical(60,200,QImage::Format_ARGB32); vertical.fill(Qt::black);
    { QPainter p(&vertical); paintPhraseStrip(p,strip,vertical.rect(),Qt::Vertical,0,2); }
    assert(vertical.pixelColor(2,25)==blended(Phrase::Kind::Intro));
    assert(vertical.pixelColor(2,150)==blended(Phrase::Kind::Chorus));
    QImage row(200,18,QImage::Format_ARGB32);row.fill(Qt::black);
    { QPainter p(&row);paintPhraseStrip(p,strip,QRectF(0,2,200,16),Qt::Horizontal,0,2,1,true); }
    assert(row.pixelColor(25,0)==QColor(Qt::black));
    assert(row.pixelColor(25,17)==phraseColor(Phrase::Kind::Intro));
    assert(row.pixelColor(150,17)==phraseColor(Phrase::Kind::Chorus));
    // Run the application's importer, not a reimplementation. TestTrack only
    // replaces the heavyweight Track storage; parsing/routing is real.
    QTemporaryDir dir; assert(dir.isValid());
    const QString datPath=dir.path()+"/ANLZ0000.DAT", extPath=dir.path()+"/ANLZ0000.EXT";
    auto track=std::make_shared<TestTrack>(); track->phrases=plain;
    assert(readPhrases(track,0,datPath).isEmpty() && track->phrases.isEmpty());
    std::string beats(8,0); u32(beats,4);
    for (int time : {100,600,1200,1900}) {u16(beats,1); u16(beats,12000); u32(beats,time);}
    writeFile(datPath,anlz(section("PQTZ",beats)));
    writeFile(extPath,anlz(section("PSSI",fixture(2,9,1,4,3,true))));
    assert(readPhrases(track,0,datPath).isEmpty() && track->phrases==plain);
    writeFile(extPath,"PMAI");
    assert(!readPhrases(track,0,datPath).isEmpty() && track->phrases==plain);
    writeFile(extPath,anlz(""));
    assert(readPhrases(track,0,datPath).isEmpty() && track->phrases.isEmpty());
}
'''
with tempfile.TemporaryDirectory(prefix='pflx-phrase-test-') as directory:
    cpp=Path(directory)/'test.cpp'; cpp.write_text(source)
    binary=Path(directory)/'test'
    flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','Qt6Core','Qt6Gui'],text=True))
    subprocess.run(['c++','-std=c++20','-fPIC','-O2','-ffast-math','-DKS_STR_ENCODING_NONE',
        '-I'+str(ROOT/'src'),'-I'+str(ROOT/'lib/rekordbox-metadata'),'-I'+str(ROOT/'lib/kaitai'),
        str(cpp),str(ROOT/'lib/rekordbox-metadata/rekordbox_anlz.cpp'),
        str(ROOT/'lib/kaitai/kaitai/kaitaistream.cpp'),fpclassify_object(directory),'-lz','-o',str(binary),*flags],check=True)
    subprocess.run([str(binary)],check=True,timeout=15,env={**os.environ,'QT_QPA_PLATFORM':'offscreen'})
    print('PSSI masked/unmasked parsing, mood labels, variable beat timing, bounds and horizontal/vertical rendering passed.')
