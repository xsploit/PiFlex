"""Exercise production marquee and deck-time methods in Qt widget fixtures.

Control transport and skin lookup are fixtures; painting, timing, mouse handling,
and mode-selection methods are extracted unchanged from the current checkout.
Run on Linux/WSL with Qt6Widgets development files. No Pi/audio required.
"""
from pathlib import Path
import os
import shlex
import subprocess
import tempfile
import xml.etree.ElementTree as ET

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


deck = ET.parse(ROOT / 'res/skins/BiteDJ/deck.xml').getroot()
wave = ET.parse(ROOT / 'res/skins/BiteDJ/waveform.xml').getroot()
skin = ET.parse(ROOT / 'res/skins/BiteDJ/skin.xml').getroot()
named = lambda name: next(n for n in deck.iter() if n.findtext('ObjectName') == name)
for name in ('DeckTitle', 'DeckArtist'):
    assert named(name).findtext('Elide') == 'scroll'
for tag in ('SignalColor', 'SignalLowColor', 'SignalMidColor', 'SignalHighColor'):
    assert named('DeckOverview').findtext(tag) == next(wave.iter(tag)).text
for node in deck.iter('NumberPos'):
    key = node.find('ModeConfigKey')
    assert key.text == '[PiFlex],time_mode'
    assert key.find('Variable').attrib['name'] == 'channel'
attributes = {n.attrib.get('config_key'): n for n in skin.iter('attribute')}
for i in range(1, 5):
    attr = attributes[f'[PiFlex],time_mode{i}']
    assert attr.text == '1' and attr.attrib['persist'] == 'true'

source = r'''
#include <QApplication>
#include <QLabel>
#include <QPainter>
#include <QElapsedTimer>
#include <QTimer>
#include <QMouseEvent>
#include <QDomDocument>
#include <QMap>
#include <cassert>
#include <algorithm>
#include <functional>
#include <vector>
#include "widget/textscroll.h"
class WLabel : public QLabel {
public:
    bool m_scrollText = true, m_scrollOverflow = false;
    QTimer m_scrollTimer;
    QElapsedTimer m_scrollClock;
    QString m_longText;
    Qt::TextElideMode m_elideMode = Qt::ElideNone;
    double m_scaleFactor = 1;
    int m_widthHint = 0;
    WLabel() {m_scrollTimer.setInterval(40);}
    void updateTooltip() {}
    void setText(const QString&);
    QRect scrollRect() const;
    void updateScrolling();
    void paintEvent(QPaintEvent*) override;
    bool event(QEvent*) override;
    void resizeEvent(QResizeEvent*) override;
    QSize sizeHint() const override;
};
'''
for signature in ('void WLabel::setText(', 'QRect WLabel::scrollRect(',
                  'void WLabel::updateScrolling(', 'void WLabel::paintEvent(',
                  'bool WLabel::event(', 'void WLabel::resizeEvent(',
                  'QSize WLabel::sizeHint('):
    source += function('src/widget/wlabel.cpp', signature) + '\n'
source += r'''
namespace TrackTime {enum class DisplayMode {ELAPSED, REMAINING, ELAPSED_AND_REMAINING};}
enum class ControlFlag {NoAssertIfMissing};
struct ControlProxy {
    inline static QMap<QString,double> values;
    inline static std::vector<ControlProxy*> proxies;
    QString key;
    std::function<void(double)> changed;
    ControlProxy(QString group, QString item, QObject*, ControlFlag):key(group+","+item) {
        proxies.push_back(this);
    }
    ~ControlProxy() {std::erase(proxies, this);}
    bool valid() const {return values.contains(key);}
    double get() const {return values.value(key);}
    void set(double value) {
        values[key] = value;
        for (auto* p: proxies) if (p->key == key && p->changed) p->changed(value);
    }
    template<class T> void connectValueChanged(T* receiver, void (T::*slot)(double)) {
        changed=[=](double value){(receiver->*slot)(value);};
    }
};
struct SkinContext {
    QString selectString(const QDomNode& node, const QString& key) const {
        return node.firstChildElement(key).text();
    }
};
class WNumber : public QLabel {
public:
    void setup(const QDomNode&, const SkinContext&) {}
};
class WNumberPos : public WNumber {
public:
    bool m_perDeckMode = false;
    TrackTime::DisplayMode m_displayMode = TrackTime::DisplayMode::REMAINING;
    double m_dOldTimeElapsed = 0;
    int refreshes = 0;
    ControlProxy* m_pShowTrackTimeRemaining;
    WNumberPos() {
        m_pShowTrackTimeRemaining=new ControlProxy("[Controls]", "ShowDurationRemaining",
                this, ControlFlag::NoAssertIfMissing);
        m_pShowTrackTimeRemaining->connectValueChanged(this, &WNumberPos::slotSetDisplayMode);
    }
    ~WNumberPos() {delete m_pShowTrackTimeRemaining;}
    void setup(const QDomNode&, const SkinContext&);
    void mousePressEvent(QMouseEvent*) override;
    void slotSetDisplayMode(double);
    void slotSetTimeElapsed(double) {++refreshes;}
};
'''
for signature in ('void WNumberPos::setup(', 'void WNumberPos::mousePressEvent(',
                  'void WNumberPos::slotSetDisplayMode('):
    source += function('src/widget/wnumberpos.cpp', signature) + '\n'
source += r'''
int main(int argc, char** argv) {
    QApplication app(argc, argv);
    using mixxx::textScrollOffset;
    assert(textScrollOffset(1000, 120, 30) == 0);
    assert(textScrollOffset(2500, 120, 30) == 30);
    assert(textScrollOffset(6000, 120, 30) == 120);
    assert(textScrollOffset(7000, 120, 30) == 0);
    assert(textScrollOffset(2500, 0, 30) == 0);
    assert(textScrollOffset(2500, 120, 0) == 0);
    assert(textScrollOffset(2500, 120, 60) == 60);
    WLabel label;
    label.resize(110, 34);
    label.setText("A very long track name that must scroll without resizing the deck");
    assert(!label.m_scrollTimer.isActive());
    label.show(); app.processEvents();
    assert(label.m_scrollOverflow && label.m_scrollTimer.isActive());
    assert(label.sizeHint().width() == 0);
    for (const auto& colors: {std::pair{QColor(Qt::white), QColor(Qt::black)},
                             std::pair{QColor(Qt::black), QColor(Qt::white)}}) {
        QPalette pal = label.palette();
        pal.setColor(label.backgroundRole(), colors.first);
        pal.setColor(label.foregroundRole(), colors.second);
        label.setPalette(pal); label.setAutoFillBackground(true);
        auto image = label.grab().toImage();
        int contrast = 0;
        for (int y=0; y<image.height(); ++y) for (int x=0; x<image.width(); ++x) {
            if (std::abs(image.pixelColor(x,y).red()-colors.first.red()) > 100) ++contrast;
        }
        assert(contrast > 30); // Actual text pixels in both light/dark palettes.
    }
    label.hide(); app.processEvents();
    assert(!label.m_scrollTimer.isActive());
    label.show(); app.processEvents();
    assert(label.m_scrollTimer.isActive());
    label.setText("Short");
    assert(!label.m_scrollOverflow && !label.m_scrollTimer.isActive());
    assert(label.QLabel::text() == "Short");
    label.setText(QString(80, 'x')); label.resize(1800, 34); app.processEvents();
    assert(!label.m_scrollTimer.isActive());
    label.resize(100, 34); app.processEvents();
    assert(label.m_scrollTimer.isActive());
    label.setText(""); assert(!label.m_scrollTimer.isActive());

    ControlProxy::values = {{"[Controls],ShowDurationRemaining",1},
                           {"[PiFlex],time_mode1",1}, {"[PiFlex],time_mode2",1}};
    WNumberPos one, mini, two, legacy, invalid;
    auto setup=[](WNumberPos& widget, QString key) {
        QDomDocument doc;
        assert(doc.setContent("<NumberPos><ModeConfigKey>"+key+"</ModeConfigKey></NumberPos>"));
        widget.setup(doc.documentElement(), SkinContext{});
    };
    setup(one,"[PiFlex],time_mode1"); setup(mini,"[PiFlex],time_mode1");
    setup(two,"[PiFlex],time_mode2"); setup(legacy,"");
    setup(invalid,"[Missing],time_mode");
    assert(!legacy.m_perDeckMode && !invalid.m_perDeckMode);
    auto click=[](WNumberPos& widget, Qt::MouseButton button) {
        QMouseEvent event(QEvent::MouseButtonPress, QPointF(5,5), QPointF(5,5),
                button, button, Qt::NoModifier);
        widget.mousePressEvent(&event);
    };
    click(one, Qt::LeftButton);
    assert(one.m_displayMode == TrackTime::DisplayMode::ELAPSED);
    assert(mini.m_displayMode == TrackTime::DisplayMode::ELAPSED);
    assert(two.m_displayMode == TrackTime::DisplayMode::REMAINING);
    assert(ControlProxy::values["[Controls],ShowDurationRemaining"] == 1);
    click(one, Qt::RightButton);
    assert(one.m_displayMode == TrackTime::DisplayMode::ELAPSED);
    click(one, Qt::LeftButton);
    assert(one.m_displayMode == TrackTime::DisplayMode::REMAINING);
    click(legacy, Qt::LeftButton);
    assert(ControlProxy::values["[Controls],ShowDurationRemaining"] == 1);
    one.m_pShowTrackTimeRemaining->set(2);
    assert(one.m_displayMode == TrackTime::DisplayMode::REMAINING);
    one.m_pShowTrackTimeRemaining->set(-123);
    assert(one.m_displayMode == TrackTime::DisplayMode::REMAINING);
    legacy.m_pShowTrackTimeRemaining->set(2);
    assert(legacy.m_displayMode == TrackTime::DisplayMode::ELAPSED_AND_REMAINING);
}
'''
with tempfile.TemporaryDirectory(prefix='pflx-deck-presentation-') as directory:
    cpp = Path(directory) / 'test.cpp'
    cpp.write_text(source)
    binary = Path(directory) / 'test'
    flags = shlex.split(subprocess.check_output(
        ['pkg-config', '--cflags', '--libs', 'Qt6Widgets', 'Qt6Xml'], text=True))
    subprocess.run(['c++', '-std=c++20', '-fPIC', '-O2', '-ffast-math',
                    '-I'+str(ROOT/'src'), str(cpp), '-o', str(binary), *flags], check=True)
    subprocess.run([str(binary)], check=True, timeout=30,
                   env={**os.environ, 'QT_QPA_PLATFORM': 'offscreen'})
print('Deck presentation: palette pixels, marquee lifecycle/geometry, independent time controls, legacy fallback, skin wiring passed.')
