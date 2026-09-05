"""Compile the real three-band display adapter and test its timing/bounds."""
from pathlib import Path
import shlex
import subprocess
import tempfile
from native_test_support import fpclassify_object

ROOT = Path(__file__).resolve().parents[2]
feature = (ROOT/'src/library/rekordbox/rekordboxfeature.cpp').read_text()
importer = feature[feature.index('QString readThreeBandWaveforms('):feature.index('QStringList readAnalyzeFiles(')]
source = r'''
#include <cassert>
#include <limits>
#include <fstream>
#include <QDateTime>
#include <QFile>
#include <QFileInfo>
#include <QTemporaryDir>
#include <QDebug>
#include "rekordbox_anlz.h"
#include "library/rekordbox/rekordboxwaveform.h"
#include "analyzer/constants.h"
using mixxx::rekordbox::decodeThreeBandWaveform;
struct TestTrack {
    WaveformPointer detail, summary;
    double getDuration() const { return 3; }
    WaveformPointer getWaveform() const { return detail; }
    WaveformPointer getWaveformSummary() const { return summary; }
    void setWaveform(WaveformPointer value) { detail=value; }
    void setWaveformSummary(WaveformPointer value) { summary=value; }
};
using TrackPointer=QSharedPointer<TestTrack>;
namespace mixxx::rekordbox {
'''+importer+r'''
}
void u32(std::string& s,unsigned n) {
    s+=char(n>>24); s+=char(n>>16); s+=char(n>>8); s+=char(n);
}
std::string tag(const std::string& name,int peak) {
    std::string body; u32(body,3); u32(body,450);
    if (name=="PWV7") u32(body,0);
    body+=std::string(450*3,char(peak));
    std::string result=name; u32(result,name=="PWV7"?24:20); u32(result,12+body.size());
    return result+body;
}
void writeFile(const QString& path,const std::string& tags) {
    std::string bytes="PMAI"; u32(bytes,28); u32(bytes,28+tags.size());
    bytes+=std::string(16,0)+tags;
    QFile file(path); assert(file.open(QIODevice::WriteOnly));
    assert(file.write(bytes.data(),bytes.size())==qint64(bytes.size()));
}
template<class F> void rejects(F f) {
    bool failed=false;
    try { f(); } catch (const std::runtime_error&) { failed=true; }
    assert(failed);
}
int main() {
    // Call the actual import boundary as well as the adapter: both published
    // waveforms must be normalized, not only the overview branch.
    QTemporaryDir dir; assert(dir.isValid());
    const auto path=dir.filePath("ANLZ0000.2EX");
    const auto dat=dir.filePath("ANLZ0000.DAT");
    writeFile(path,tag("PWV6",58)+tag("PWV7",125));
    auto track=TrackPointer::create();
    using mixxx::rekordbox::readThreeBandWaveforms;
    assert(readThreeBandWaveforms(track,mixxx::audio::SampleRate(44100),0,dat).isEmpty());
    assert(track->detail && track->summary);
    assert(track->detail->data()[0].filtered.all==255);
    assert(track->summary->data()[0].filtered.all==255);
    assert(track->detail->saveState()==Waveform::SaveState::Saved);
    assert(track->summary->saveState()==Waveform::SaveState::Saved);
    auto previous=track->detail;
    assert(readThreeBandWaveforms(track,mixxx::audio::SampleRate(44100),0,dat).isEmpty());
    assert(track->detail==previous); // unchanged file reuses validated pair
    writeFile(path,tag("PWV6",40));
    assert(!readThreeBandWaveforms(track,mixxx::audio::SampleRate(44100),0,dat).isEmpty());
    assert(track->detail==previous); // incomplete pair cannot replace one view
    const std::string samples{"\x0a\x14\x1e\x28\x32\x3c",6};
    auto wave=decodeThreeBandWaveform(samples,150,150,3,0);
    assert(wave.size()==6);
    assert(wave[0].filtered.mid==10 && wave[0].filtered.high==20 && wave[0].filtered.low==30);
    assert(wave[0].filtered.all==30 && wave[0].m_i==wave[1].m_i);
    assert(wave[2].filtered.mid==40 && wave[2].filtered.high==50 && wave[2].filtered.low==60);
    assert(wave[4].m_i==0 && wave[5].m_i==0); // no stretched/held tail
    auto preview=decodeThreeBandWaveform(samples,150,150,3,0,true);
    assert(preview[2].filtered.low==255 && preview[2].filtered.mid==170);
    assert(preview[0].filtered.mid==43 && preview[0].filtered.high==85 && preview[0].filtered.low==128);
    assert(preview[0].m_i==preview[1].m_i && preview[4].m_i==0);
    auto silence=decodeThreeBandWaveform(std::string(6,'\0'),150,150,2,0,true);
    assert(silence[0].m_i==0 && silence[2].m_i==0);
    // Both exported resolutions use the full display range, regardless of
    // their independent byte scales. Timing/padding and the relative envelope
    // must not change. Exercise all 256 input values, not just one song.
    for (int columns : {1200,30000}) {
        for (int peak : {1,58,125,255}) {
            std::string envelope(size_t(columns)*3,'\0');
            for (int i=0;i<columns;++i) {
                envelope[size_t(i)*3]=char(i%(peak+1));
                envelope[size_t(i)*3+1]=char((i%(peak+1))/2);
            }
            auto normalized=decodeThreeBandWaveform(envelope,150,150,columns+1,0,true);
            for (int i=0;i<columns;++i) {
                const int raw=i%(peak+1);
                const int expected=(raw*255+peak/2)/peak;
                const auto& value=normalized[size_t(i)*2];
                assert(value.filtered.mid==expected && value.filtered.all==expected);
                assert(value.filtered.high==((raw/2)*255+peak/2)/peak);
                assert(value.filtered.low==0 && value.m_i==normalized[size_t(i)*2+1].m_i);
            }
            assert(normalized[size_t(columns)*2].m_i==0);
            auto shifted=decodeThreeBandWaveform(envelope,150,150,columns,7,true);
            assert(shifted[0].m_i==normalized[2].m_i);
            assert(shifted[size_t(columns-1)*2].m_i==0);
        }
    }
    wave=decodeThreeBandWaveform(samples,150,300,4,0);
    assert(wave[0].m_i==wave[2].m_i && wave[4].m_i==wave[6].m_i);
    wave=decodeThreeBandWaveform(samples,150,150,2,7);
    assert(wave[0].filtered.low==60 && wave[2].m_i==0); // same offset sign as cues
    wave=decodeThreeBandWaveform(samples,150,150,2,-7);
    assert(wave[0].m_i==0);
    const std::string unsignedBytes{"\xff\x80\xfe",3};
    wave=decodeThreeBandWaveform(unsignedBytes,150,150,1,0);
    assert(wave[0].filtered.mid==255 && wave[0].filtered.high==128 && wave[0].filtered.low==254);
    std::string longWave(30000,'\0');
    for (int i=0;i<10000;++i) longWave[size_t(i)*3]=char(i%251);
    wave=decodeThreeBandWaveform(longWave,150,150,10000,0);
    for (int i=0;i<10000;++i) assert(wave[size_t(i)*2].filtered.mid==i%251);
    // Use the real Waveform allocation/ratio, including rounded frame lengths
    // and its extra padded column. Overview columns must remain one-to-one.
    for (int rate : {32000,44100,48000,96000}) {
        for (SINT frames : {SINT(1234567),SINT(17234567),SINT(28234567)}) {
            Waveform overview(rate,frames,150,20000);
            const double allocatedRate=double(rate)/overview.getAudioVisualRatio();
            auto mapped=decodeThreeBandWaveform(longWave,allocatedRate,allocatedRate,
                    overview.getDataSize()/2,0);
            assert(overview.getDataSize()/2>=10000);
            for (int i=0;i<10000;++i) assert(mapped[size_t(i)*2].filtered.mid==i%251);
            for (size_t i=20000;i<mapped.size();++i) assert(mapped[i].m_i==0);
        }
    }
    rejects([&]{decodeThreeBandWaveform("",150,150,1,0);});
    rejects([&]{decodeThreeBandWaveform("bad!",150,150,1,0);});
    rejects([&]{decodeThreeBandWaveform(samples,0,150,1,0);});
    rejects([&]{decodeThreeBandWaveform(samples,150,std::numeric_limits<double>::quiet_NaN(),1,0);});
    rejects([&]{decodeThreeBandWaveform(samples,150,150,0,0);});
    rejects([&]{decodeThreeBandWaveform(samples,150,150,5000000,0);});
}
'''
# Compile production constructor and allocation methods against the real class;
# omit only unrelated protobuf serialization to keep this fixture standalone.
implementation = (ROOT/'src/waveform/waveform.cpp').read_text()
definitions = []
for signature in ['int computeTextureStride(', 'Waveform::Waveform(\n',
                  'Waveform::~Waveform(', 'void Waveform::assign(']:
    start=implementation.index(signature); end=implementation.index('{',start)+1; depth=1
    while depth:
        if implementation[end]=='{': depth+=1
        if implementation[end]=='}': depth-=1
        end+=1
    definitions.append(implementation[start:end])
source=source.replace('int main() {','\n'.join(definitions)+'\nint main() {')
with tempfile.TemporaryDirectory(prefix='pflx-waveform-test-') as directory:
    cpp=Path(directory)/'test.cpp'; cpp.write_text(source)
    binary=Path(directory)/'test'
    flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','Qt6Core'],text=True))
    subprocess.run(['c++','-std=c++20','-fPIC','-O2','-ffast-math','-DKS_STR_ENCODING_NONE',
        '-I'+str(ROOT/'src'),'-I'+str(ROOT/'lib/rekordbox-metadata'),'-I'+str(ROOT/'lib/kaitai'),str(cpp),
        str(ROOT/'lib/rekordbox-metadata/rekordbox_anlz.cpp'),
        str(ROOT/'lib/kaitai/kaitai/kaitaistream.cpp'),'-lz',
        fpclassify_object(directory),'-o',str(binary),*flags],check=True)
    subprocess.run([str(binary)],check=True,timeout=10)
    print('Three-band channel order, mono mapping, timing offsets, rate conversion and invalid-input checks passed.')
