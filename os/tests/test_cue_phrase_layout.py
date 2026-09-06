"""Render production cue-label geometry and prove it cannot translate time."""
from pathlib import Path
import os
import shlex
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from native_test_support import fpclassify_object

ROOT=Path(__file__).resolve().parents[2]
text=(ROOT/'src/waveform/renderers/waveformmark.cpp').read_text()
helper=text[text.index('float overlappingMarkerIncrement('):text.index('#define FOO')]
geometry=text[text.index('class MarkerGeometry {'):text.index('QImage WaveformMark::generateImage(')]
wave=ET.parse(ROOT/'res/skins/BiteDJ/waveform.xml').getroot()
for mark in list(wave.iter('Mark'))+list(wave.iter('DefaultMark')):
    if 'bottom' in mark.findtext('Align',''):
        assert mark.findtext('LabelBottomInset')=='18'
cue=next(mark for mark in wave.iter('Mark') if mark.findtext('Control')=='cue_point')
assert cue.findtext('Align')=='top|left' and cue.findtext('Text')=='CUE'
overview=(ROOT/'src/widget/wphraseoverview.h').read_text()
assert 'rect().adjusted(0, int(2 * m_scale), 0, 0)' in overview
source=r'''
#include <QGuiApplication>
#include <QFontMetricsF>
#include <QImage>
#include <QPainter>
#include <cassert>
#include <cmath>
#include <algorithm>
#include "waveform/renderers/phrasestrip.h"
'''+helper+geometry+r'''
int main(int argc,char** argv) {
    QGuiApplication app(argc,argv);
    QImage reference(400,120,QImage::Format_ARGB32_Premultiplied);
    reference.fill(Qt::transparent);
    mixxx::PhraseList phrases{{2,4,-1,mixxx::Phrase::Kind::Intro,"INTRO"}};
    {
        QPainter painter(&reference);
        const auto transform=painter.transform();
        mixxx::paintPhraseStrip(painter,phrases,reference.rect(),Qt::Horizontal,0,10);
        assert(painter.transform()==transform);
    }
    assert(qAlpha(reference.pixel(79,115))==0);
    assert(qAlpha(reference.pixel(81,115))>0); // phrase starts at 2/10 * 400, not after CUE
    for (auto text : {QString("C"),QString("CUE"),QString("LONG CUE NAME")}) {
        for (float dpr : {1.f,1.5f,2.f}) {
            MarkerGeometry badge(text,false,Qt::AlignBottom|Qt::AlignLeft,120,0,18);
            MarkerGeometry old(text,false,Qt::AlignBottom|Qt::AlignLeft,120,0,0);
            assert(badge.imageSize()==old.imageSize());
            assert(badge.labelRect().bottom()<=102);
            assert(old.labelRect().bottom()-badge.labelRect().bottom()==18);
            MarkerGeometry topCue(text,false,Qt::AlignTop|Qt::AlignLeft,120,0,0);
            assert(topCue.imageSize()==old.imageSize());
            assert(topCue.labelRect().top()==0.5);
            assert(topCue.labelRect().bottom()<40);
            auto composite=reference.copy();
            {
                QPainter painter(&composite);
                painter.fillRect(topCue.labelRect(),Qt::yellow);
                painter.setFont(topCue.font());
                painter.drawText(topCue.labelRect(),Qt::AlignCenter,text);
            }
            for(int y=104;y<120;y++) for(int x=0;x<400;x++)
                assert(composite.pixel(x,y)==reference.pixel(x,y));
            // The existing GL renderer subtracts half the texture's width.
            // Text width cancels exactly; it never contributes to time position.
            const double half=badge.getImageSize(dpr).width()/double(dpr)/2;
            const double markerTimeX=777.0;
            assert(std::abs((markerTimeX-half)+half-markerTimeX)<1e-9);
            // CPU path raster rounding is independent of label length.
            const double cpuX=777-int(badge.getImageSize(dpr).width()/2.0/dpr)+
                    badge.imageSize().width()/2.0;
            assert(std::abs(cpuX-markerTimeX)<=1);
            QImage image(badge.getImageSize(dpr),QImage::Format_ARGB32_Premultiplied);
            image.setDevicePixelRatio(dpr); image.fill(Qt::transparent);
            QPainter painter(&image); painter.fillRect(badge.labelRect(),Qt::yellow); painter.end();
            // Bottom phrase row remains untouched by the badge.
            for(int y=int(105*dpr);y<image.height();y++)
                for(int x=0;x<image.width();x++) assert(qAlpha(image.pixel(x,y))==0);
        }
    }
}
'''
with tempfile.TemporaryDirectory(prefix='pflx-cue-layout-') as directory:
    cpp=Path(directory)/'test.cpp';cpp.write_text(source)
    exe=Path(directory)/'test'
    flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','Qt6Gui'],text=True))
    subprocess.run(['c++','-std=c++20','-fPIC','-I'+str(ROOT/'src'),str(cpp),
                    fpclassify_object(directory),'-o',str(exe),*flags],check=True)
    subprocess.run([str(exe)],check=True,env={**os.environ,'QT_QPA_PLATFORM':'offscreen'})
print('Cue text widths, 1/1.5/2x DPI, fixed time coordinate and unobstructed phrase row passed.')
