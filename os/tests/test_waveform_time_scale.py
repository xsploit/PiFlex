"""Run the production pre-render calculation with mixed analysis densities.

Uses real Waveform allocation; audio controls and VSync positions are fixtures.
Fails on the original renderer (441 Hz native versus 150 Hz imported detail).
"""
from pathlib import Path
import shlex
import subprocess
import tempfile
from native_test_support import fpclassify_object

ROOT = Path(__file__).resolve().parents[2]


def function(path, signature):
    text = (ROOT / path).read_text()
    start = text.index(signature)
    cursor = text.index('{', start) + 1
    depth = 1
    while depth:
        depth += (text[cursor] == '{') - (text[cursor] == '}')
        cursor += 1
    return text[start:cursor]


source = r'''
#include <cassert>
#include <cmath>
#include <iostream>
#include "util/math.h"
#include "util/fpclassify.h"
#include "analyzer/constants.h"
#include "waveform/waveform.h"
struct VSyncThread {};
struct WaveformRendererAbstract {enum {Play, Slip};};
struct ControlFixture {double value=1; double get() const {return value;}};
struct PositionFixture {
    double play=0.5, slip=0.25;
    void getPlaySlipAtNextVSync(VSyncThread*, double* p, double* s) {*p=play; *s=slip;}
};
struct TrackFixture {
    WaveformPointer waveform;
    int sampleRate=44100;
    int getSampleRate() const {return sampleRate;}
    auto getWaveform() const {return waveform;}
};
using TrackPointer = QSharedPointer<TrackFixture>;
class WaveformWidgetRenderer {
public:
    bool m_passthroughEnabled=false;
    ControlFixture samples, rate, gain;
    ControlFixture* m_pTrackSamplesControlObject=&samples;
    ControlFixture* m_pRateRatioCO=&rate;
    ControlFixture* m_pGainControlObject=&gain;
    PositionFixture position;
    PositionFixture* m_visualPlayPosition=&position;
    TrackPointer m_pTrack=TrackPointer::create();
    double m_trackSamples=0, m_gain=0, m_zoomFactor=2, m_scaleFactor=1;
    double m_visualSamplePerPixel=0, m_audioSamplePerPixel=0;
    double m_trackPixelCount=0, m_playMarkerPosition=0.5;
    int m_totalVSamples=0, m_posVSample[2]{};
    double m_pos[2]{}, m_truePosSample[2]{}, m_firstDisplayedPosition[2]{}, m_lastDisplayedPosition[2]{};
    int length=1560;
    int getLength() const {return length;}
    void onPreRender(VSyncThread*);
    void load(int audioRate, int visualRate) {
        m_pTrack->sampleRate=audioRate;
        samples.value=audioRate*60.0*2;
        m_pTrack->waveform=WaveformPointer::create(audioRate, audioRate*60, visualRate, -1);
    }
};
'''
# Include the actual reference-rate constant when present, so changing it cannot
# silently diverge from the fixture. The old renderer has no such constant.
renderer = (ROOT / 'src/waveform/renderers/waveformwidgetrenderer.cpp').read_text()
for line in renderer.splitlines():
    if line.startswith('constexpr double kReferenceVisualSampleRate'):
        source += line + '\n'
for sig in ['int computeTextureStride(', 'Waveform::Waveform(\n',
            'Waveform::~Waveform(', 'void Waveform::assign(']:
    source += function('src/waveform/waveform.cpp', sig) + '\n'
source += function('src/waveform/renderers/waveformwidgetrenderer.cpp',
                   'void WaveformWidgetRenderer::onPreRender(')
source += r'''
bool near(double a, double b) {return std::abs(a-b)<1e-7;}
int main() {
    WaveformWidgetRenderer native, imported;
    native.load(44100,441); imported.load(44100,150);
    native.onPreRender(nullptr); imported.onPreRender(nullptr);
    auto beatPixels=[](const WaveformWidgetRenderer& r,int sr) {
        return sr*60.0/140/r.m_audioSamplePerPixel;
    };
    std::cout << "140 BPM, zoom 2: native=" << beatPixels(native,44100)
              << " imported=" << beatPixels(imported,44100) << " pixels/beat" << std::endl;
    assert(near(beatPixels(native,44100),94.5)); // Preserve existing native zoom.
    assert(near(beatPixels(native,44100),beatPixels(imported,44100)));
    // Covers pairwise mixed sources, sample rates, zoom limits, HiDPI and tempo
    // changes. Displayed time span must not depend on analysis-point density.
    for (int sr: {32000,44100,48000,96000}) {
        for (int density: {150,300,441,882}) {
            native.load(sr,441); imported.load(sr,density);
            for (double zoom: {1.,2.,3.,6.,160.}) for (double scale: {1.,1.5,2.}) {
                for (double rate: {0.,0.001,0.5,1.,1.08,2.}) {
                    native.m_zoomFactor=imported.m_zoomFactor=zoom;
                    native.m_scaleFactor=imported.m_scaleFactor=scale;
                    native.rate.value=imported.rate.value=rate;
                    native.onPreRender(nullptr); imported.onPreRender(nullptr);
                    assert(near(native.m_audioSamplePerPixel,imported.m_audioSamplePerPixel));
                    assert(near(native.m_firstDisplayedPosition[0], imported.m_firstDisplayedPosition[0]));
                    assert(near(native.m_lastDisplayedPosition[1], imported.m_lastDisplayedPosition[1]));
                    assert(near(imported.m_visualSamplePerPixel,
                                native.m_visualSamplePerPixel*density/441.));
                    assert(native.rate.value==rate && imported.rate.value==rate);
                    // Both advance the same pixels over one second. Audio/VSync
                    // coordinates remain unchanged by the display conversion.
                    double before=native.m_pos[0]*native.m_trackPixelCount;
                    native.position.play=imported.position.play=0.5+rate/60.;
                    native.onPreRender(nullptr); imported.onPreRender(nullptr);
                    assert(near(native.m_pos[0]*native.m_trackPixelCount,
                                imported.m_pos[0]*imported.m_trackPixelCount));
                    assert(near(native.m_truePosSample[0], (0.5+rate/60)*sr*120));
                    if (rate==1.) assert(std::abs(native.m_pos[0]*native.m_trackPixelCount-before
                                                 -sr/native.m_audioSamplePerPixel)<=1.01);
                    native.position.play=imported.position.play=0.5;
                }
            }
        }
    }
    native.load(44100,441); imported.load(48000,150);
    native.rate.value=imported.rate.value=1;
    native.m_zoomFactor=imported.m_zoomFactor=2;
    native.m_scaleFactor=imported.m_scaleFactor=1;
    native.onPreRender(nullptr); imported.onPreRender(nullptr);
    assert(near(beatPixels(native,44100),beatPixels(imported,48000)));
    assert(near(native.m_firstDisplayedPosition[0], imported.m_firstDisplayedPosition[0]));
    imported.m_pTrack->waveform.clear(); imported.onPreRender(nullptr);
    assert(imported.m_pos[0]==-1 && imported.m_pos[1]==-1);
    imported.load(0,150); imported.samples.value=100; imported.onPreRender(nullptr);
    assert(imported.m_pos[0]==-1 && imported.m_pos[1]==-1);
    // Empty tracks must not cause any arithmetic fault.
    imported.m_passthroughEnabled=true; imported.onPreRender(nullptr);
    assert(imported.m_pos[0]==-1 && imported.m_pos[1]==-1);
}
'''
with tempfile.TemporaryDirectory(prefix='pflx-waveform-time-') as directory:
    cpp = Path(directory) / 'test.cpp'
    cpp.write_text(source)
    binary = Path(directory) / 'test'
    flags = shlex.split(subprocess.check_output(
        ['pkg-config', '--cflags', '--libs', 'Qt6Core'], text=True))
    subprocess.run(['c++', '-std=c++20', '-fPIC', '-O2', '-ffast-math',
                    '-I'+str(ROOT/'src'), str(cpp), fpclassify_object(directory),
                    '-o', str(binary), *flags], check=True)
    subprocess.run([str(binary)], check=True, timeout=30)
print('Mixed waveform time scales: native zoom, beat spacing, scroll speed, slip, sample rates, zoom/HiDPI and unchanged audio controls passed.')
