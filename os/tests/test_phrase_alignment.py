"""Exercise phrase projection against the production immutable Beats implementation."""
from pathlib import Path
import shlex
import subprocess
import tempfile
from native_test_support import fpclassify_object

ROOT = Path(__file__).resolve().parents[2]
source = r'''
#include <cassert>
#include <cmath>
#include "track/phrasealignment.h"
using namespace mixxx;
void near(double actual, double expected) { assert(std::abs(actual-expected)<1e-7); }
int main() {
    const audio::SampleRate rate(48000);
    const auto grid = Beats::fromConstTempo(rate, audio::FramePos(4800), Bpm(120));
    PhraseList phrases{{0.1, 4.1, 3.6, Phrase::Kind::Intro, "INTRO"}};
    auto shifted = Beats::fromConstTempo(rate, audio::FramePos(-4800), Bpm(120));
    auto result = alignPhrases(phrases, grid, shifted);
    near(result[0].startSeconds, -0.1); near(result[0].endSeconds, 3.9);
    near(result[0].fillSeconds, 3.4);
    assert(alignPhrases(phrases, grid, grid) == phrases); // undo/reset
    assert(alignPhrases(phrases, grid, {}) == phrases);
    for (int i=0;i<1000;i++) {
        auto edit = Beats::fromConstTempo(rate, audio::FramePos(4800+i), Bpm(120));
        near(alignPhrases(phrases,grid,edit)[0].endSeconds,4.1+i/48000.0);
    }
    const auto fast = Beats::fromConstTempo(rate,audio::FramePos(4800),Bpm(240));
    near(alignPhrases(phrases,grid,fast)[0].endSeconds,2.1);
    const auto variable = Beats::fromBeatPositions(rate,
            {audio::FramePos(4800),audio::FramePos(28800),audio::FramePos(57600),audio::FramePos(91200)});
    const auto shiftedVariable = Beats::fromBeatPositions(rate,
            {audio::FramePos(5280),audio::FramePos(29280),audio::FramePos(58080),audio::FramePos(91680)});
    PhraseList between{{0.85,1.55,-1,Phrase::Kind::Chorus,"CHORUS"}};
    result=alignPhrases(between,variable,shiftedVariable);
    near(result[0].startSeconds,.86); near(result[0].endSeconds,1.56);
    assert(result[0].fillSeconds==-1 && result[0].label=="CHORUS");
    // Different sample rates must not leak into the seconds timebase.
    auto otherRate=Beats::fromConstTempo(audio::SampleRate(44100),audio::FramePos(4410),Bpm(120));
    near(alignPhrases(phrases,grid,otherRate)[0].endSeconds,4.1);
}
'''
with tempfile.TemporaryDirectory(prefix='pflx-phrase-grid-') as directory:
    temp=Path(directory)
    (temp/'test.cpp').write_text(source)
    subprocess.run(['protoc','-I'+str(ROOT/'src'),'--cpp_out='+directory,
                    str(ROOT/'src/proto/beats.proto')],check=True)
    flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','Qt6Core','protobuf'],text=True))
    subprocess.run(['c++','-std=c++20','-fPIC','-O2','-ffast-math','-ffunction-sections',
        '-fdata-sections','-Wl,--gc-sections','-I'+str(ROOT/'src'),'-I'+directory,
        str(temp/'test.cpp'),str(ROOT/'src/track/beats.cpp'),str(ROOT/'src/track/bpm.cpp'),
        str(temp/'proto/beats.pb.cc'),fpclassify_object(directory),'-o',str(temp/'test'),*flags],check=True)
    subprocess.run([str(temp/'test')],check=True,timeout=15)
print('Production beat-grid phrase mapping: translation, tempo, variable grid, undo, 1000 nudges, sample rates passed.')
