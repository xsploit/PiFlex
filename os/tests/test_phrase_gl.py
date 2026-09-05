"""Run actual phrase GL drawing + shaders in Mesa/Xvfb; deck state is a fixture."""
from pathlib import Path
import os
import shlex
import subprocess
import tempfile
from native_test_support import fpclassify_object

ROOT = Path(__file__).resolve().parents[2]
def function(path, signature):
    text=(ROOT/path).read_text(); start=text.index(signature); body=text.index('{',start)
    depth=1; cursor=body+1
    while depth:
        if text[cursor]=='{': depth+=1
        if text[cursor]=='}': depth-=1
        cursor+=1
    return text[start:cursor]

mark='src/waveform/renderers/allshader/waveformrendermark.cpp'
source=r'''
#include <QGuiApplication>
#include <QOffscreenSurface>
#include <QOpenGLContext>
#include <QOpenGLFramebufferObject>
#include <QOpenGLFunctions>
#include <QMap>
#include <cassert>
#include "shaders/rgbashader.h"
#include "shaders/textureshader.h"
#include "util/opengltexture2d.h"
#include "util/colorcomponents.h"
#include "waveform/renderers/allshader/vertexdata.h"
#include "waveform/renderers/allshader/rgbadata.h"
#include "waveform/renderers/phrasestrip.h"
struct TrackFixture {
    mixxx::PhraseList phrases;
    int getSampleRate() const {return 44100;}
    mixxx::PhraseList getPhrases() const {return phrases;}
};
struct RendererFixture {
    std::shared_ptr<TrackFixture> track=std::make_shared<TrackFixture>();
    double dpr=1;
    double first=0,last=2;
    auto getTrackInfo() const {return track;}
    int getLength() const {return 200;}
    int getBreadth() const {return 60;}
    double getDevicePixelRatio() const {return dpr;}
    double transformSamplePositionInRendererWorld(double sample) const {
        return (sample/88200-first)/(last-first)*200;
    }
};
namespace allshader {
class WaveformRenderMark : public QOpenGLFunctions {
public:
    RendererFixture* m_waveformRenderer;
    bool m_isSlipRenderer=false;
    mixxx::RGBAShader m_rgbaShader;
    mixxx::TextureShader m_textureShader;
    QMap<QString,std::shared_ptr<OpenGLTexture2D>> m_phraseLabels;
    double m_phraseLabelDpr=0;
    int m_phraseLabelHeight=0;
    double scaleFactor() const {return 1;}
    void drawPhrases(const QMatrix4x4& matrix);
    void drawTexture(const QMatrix4x4& matrix,float x,float y,QOpenGLTexture* texture);
};
}
'''+function('src/util/opengltexture2d.cpp','OpenGLTexture2D::OpenGLTexture2D()')+'\n'+function('src/util/opengltexture2d.cpp','void OpenGLTexture2D::setData(const QImage& image)')+'\n'+function(mark,'void allshader::WaveformRenderMark::drawTexture(')+'\n'+function(mark,'void allshader::WaveformRenderMark::drawPhrases(')+r'''
int main(int argc,char** argv) {
    QGuiApplication app(argc,argv);
    QOffscreenSurface surface; surface.create();
    QOpenGLContext context; assert(context.create()); assert(context.makeCurrent(&surface));
    RendererFixture state;
    state.track->phrases={{0,1,-1,mixxx::Phrase::Kind::Intro,"Intro"},
                         {1,2,-1,mixxx::Phrase::Kind::Chorus,"Chorus"}};
    allshader::WaveformRenderMark renderer; renderer.m_waveformRenderer=&state;
    renderer.initializeOpenGLFunctions(); renderer.m_rgbaShader.init(); renderer.m_textureShader.init();
    assert(renderer.m_rgbaShader.isLinked() && renderer.m_textureShader.isLinked());
    QOpenGLFramebufferObjectFormat format;
    format.setInternalTextureFormat(GL_RGB8); // opaque window surface, not an alpha image
    QOpenGLFramebufferObject fbo(200,60,format); assert(fbo.bind());
    renderer.glViewport(0,0,200,60);
    renderer.glEnable(GL_BLEND); renderer.glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);
    QMatrix4x4 matrix; matrix.ortho(QRectF(0,0,200,60));
    auto clear=[&]{renderer.glClearColor(0,0,0,1);renderer.glClear(GL_COLOR_BUFFER_BIT);};
    clear(); renderer.drawPhrases(matrix);
    auto image=fbo.toImage();
    const auto matches=[](QColor actual,mixxx::Phrase::Kind kind) {
        auto color=mixxx::phraseColor(kind);
        return std::abs(actual.red()-color.red()*0.75)<2 &&
            std::abs(actual.green()-color.green()*0.75)<2 && std::abs(actual.blue()-color.blue()*0.75)<2;
    };
    assert(matches(image.pixelColor(25,58),mixxx::Phrase::Kind::Intro));
    assert(matches(image.pixelColor(150,58),mixxx::Phrase::Kind::Chorus));
    assert(image.pixelColor(25,10)==QColor(Qt::black));
    // Text rendered and textures reused on the next frame.
    int white=0;
    for(int y=45;y<57;++y) for(int x=3;x<70;++x) {
        auto c=image.pixelColor(x,y); if(c.red()>220 && c.green()>220 && c.blue()>220) ++white;
    }
    assert(white>0 && renderer.m_phraseLabels.size()==2);
    auto texture=renderer.m_phraseLabels["Intro"].get();
    renderer.drawPhrases(matrix); assert(renderer.m_phraseLabels["Intro"].get()==texture);
    state.first=1;state.last=2; clear();renderer.drawPhrases(matrix);
    assert(matches(fbo.toImage().pixelColor(25,58),mixxx::Phrase::Kind::Chorus));
    renderer.m_isSlipRenderer=true;clear();renderer.drawPhrases(matrix);
    assert(fbo.toImage().pixelColor(25,58)==QColor(Qt::black));
    renderer.m_isSlipRenderer=false;state.track->phrases.clear();clear();renderer.drawPhrases(matrix);
    assert(fbo.toImage().pixelColor(25,58)==QColor(Qt::black));
    assert(renderer.glGetError()==GL_NO_ERROR);
}
'''
with tempfile.TemporaryDirectory(prefix='pflx-phrase-gl-') as directory:
    cpp=Path(directory)/'test.cpp';cpp.write_text(source);binary=Path(directory)/'test'
    flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','Qt6Core','Qt6Gui','Qt6OpenGL'],text=True))
    subprocess.run(['c++','-std=c++20','-fPIC','-O2','-ffast-math','-DMIXXX_USE_QOPENGL', '-I'+str(ROOT/'src'),
        str(cpp),*[str(ROOT/'src/shaders'/name) for name in ['shader.cpp','rgbashader.cpp','textureshader.cpp']],
        str(ROOT/'src/util/colorcomponents.cpp'),fpclassify_object(directory),
        '-o',str(binary),*flags],check=True)
    subprocess.run(['xvfb-run','-a',str(binary)],check=True,timeout=30,
        env={**os.environ,'QT_QPA_PLATFORM':'xcb','LIBGL_ALWAYS_SOFTWARE':'1'})
    print('Actual GL phrase drawing/shaders: pixels, labels, texture reuse, scrolling, slip and unload passed.')
