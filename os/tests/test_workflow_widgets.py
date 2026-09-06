"""Real button event/timer methods in a Qt fixture; XML wiring and display defaults."""
from pathlib import Path
import os
import shlex
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from native_test_support import fpclassify_object

ROOT=Path(__file__).resolve().parents[2]
text=(ROOT/'src/widget/wpushbutton.cpp').read_text()
def function(signature):
    start=text.index(signature); cursor=text.index('{',start)+1; depth=1
    while depth:
        depth+=(text[cursor]=='{')-(text[cursor]=='}'); cursor+=1
    return text[start:cursor]

library=ET.parse(ROOT/'res/skins/BiteDJ/library.xml').getroot()
assert len(list(library.iter('SearchBox')))==1
grid=ET.parse(ROOT/'res/skins/BiteDJ/templates/grid_deck_row.xml').getroot()
buttons=list(grid.iter('PushButton'))
assert len(buttons)==5
assert sum(b.findtext('AutoRepeat')=='true' for b in buttons)==4
assert all(b.findtext('Size')=='0me,54f' for b in buttons)
assert next(b for b in buttons if b.findtext('ObjectName')=='GridPanel_SetButton').find('AutoRepeat') is None
settings=ET.parse(ROOT/'res/skins/BiteDJ/settings.xml').getroot()
assert len([n for n in settings.iter('WidgetGroup') if n.attrib.get('trigger')=='[SettingsTab],stream'])==1
assert any(c.text=='[Shoutcast],enabled' for c in settings.iter('ConfigKey'))
assert any(c.text=='[Metadata],enabled' for c in settings.iter('ConfigKey'))
system_settings=(ROOT/'src/preferences/systemsettings.cpp').read_text()
binary_binding=system_settings.split('const auto bindBinaryPreference =',1)[1].split('\n    };',1)[0]
assert 'std::make_unique<ControlPushButton>(key)' in binary_binding
assert 'setButtonMode(ControlPushButton::TOGGLE)' in binary_binding
assert 'setStates(2)' in binary_binding
mapping=ET.parse(ROOT/'res/controllers/Pioneer-DDJ-FLX6.midi.xml').getroot()
zoom=[c for c in mapping.iter('control') if c.findtext('key')=='PioneerDDJFLX6.waveformZoom']
assert len(zoom)==1 and zoom[0].findtext('midino')=='0x64'

source=r'''
#include <QApplication>
#include <QWidget>
#include <QMouseEvent>
#include <QFocusEvent>
#include <QTimer>
#include <QElapsedTimer>
#include <QThread>
#include <memory>
#include <vector>
#include <cassert>
#include <iostream>
#include "util/fpclassify.h"
using WWidget=QWidget;
struct ControlPushButton {enum ButtonMode{PUSH,TRIGGER,POWERWINDOW,LONGPRESSLATCHING,TOGGLE};};
struct ControlPushButtonBehavior {static constexpr int kPowerWindowTimeMillis=300,kLongPressLatchingTimeMillis=300;};
struct Latch {void start(){} void stop(){}};
struct Context {bool repeat; bool selectBool(int,const char*,bool)const{return repeat;}};
class WPushButton: public QWidget {
public:
 bool m_bPressed=false,m_bHovered=false,m_repeatEnabled=false;
 int m_iNoStates=1;
 ControlPushButton::ButtonMode m_leftButtonMode=ControlPushButton::PUSH,m_rightButtonMode=ControlPushButton::PUSH;
 QTimer m_clickTimer,m_repeatTimer;
 std::unique_ptr<Latch> m_pLongPressLatching;
 double value=0; std::vector<double> pulses;
 double getControlParameterLeft(){return value;}
 void setControlParameterLeftDown(double v){value=v;pulses.push_back(v);}
 void setControlParameterLeftUp(double v){value=v;}
 void setControlParameterRightDown(double){} void setControlParameterRightUp(double){}
 void restyleAndRepaint(){}
 void mousePressEvent(QMouseEvent*) override; void mouseReleaseEvent(QMouseEvent*) override;
 bool event(QEvent*) override; void focusOutEvent(QFocusEvent*) override;
 void setup(bool repeat){int iNumStates=1,node=0;Context context{repeat};
'''
start=text.index('    m_repeatEnabled = iNumStates')
end=text.index('    // Set background pixmap',start)
source+=text[start:end]+'\n}};\n'
for name in ('void WPushButton::mousePressEvent','void WPushButton::mouseReleaseEvent',
             'bool WPushButton::event','void WPushButton::focusOutEvent'):
    source+=function(name)+'\n'
source+=r'''
void pump(int ms){QElapsedTimer t;t.start();while(t.elapsed()<ms){QCoreApplication::processEvents();QThread::msleep(1);}}
void press(WPushButton& w){QMouseEvent e(QEvent::MouseButtonPress,QPointF(10,10),QPointF(10,10),Qt::LeftButton,Qt::LeftButton,Qt::NoModifier);w.mousePressEvent(&e);}
void release(WPushButton& w){QMouseEvent e(QEvent::MouseButtonRelease,QPointF(10,10),QPointF(10,10),Qt::LeftButton,Qt::NoButton,Qt::NoModifier);w.mouseReleaseEvent(&e);}
int main(int argc,char**argv){QApplication app(argc,argv);WPushButton w;w.setup(true);w.show();pump(30);
 press(w);pump(180);assert(w.pulses.size()==1);pump(380);assert(w.pulses.size()>=5);
 release(w);auto n=w.pulses.size();pump(180);assert(w.pulses.size()==n);
 press(w);w.hide();n=w.pulses.size();pump(430);assert(w.pulses.size()==n);
 w.show();press(w);QEvent leave(QEvent::Leave);QCoreApplication::sendEvent(&w,&leave);n=w.pulses.size();pump(430);assert(w.pulses.size()==n);
 press(w);w.setEnabled(false);n=w.pulses.size();pump(430);assert(w.pulses.size()==n);
 w.setEnabled(true);press(w);QEvent deactivate(QEvent::WindowDeactivate);QCoreApplication::sendEvent(&w,&deactivate);n=w.pulses.size();pump(430);assert(w.pulses.size()==n);
 w.setup(false);press(w);n=w.pulses.size();pump(430);assert(w.pulses.size()==n);
 // Setting widgets emit on press only, with persistent two-state toggles.
 w.m_iNoStates=2;w.m_leftButtonMode=ControlPushButton::TOGGLE;w.value=0;
 press(w);assert(w.value==1);press(w);assert(w.value==0);press(w);assert(w.value==1);
 std::cout<<"workflow widgets: repeat delay/cadence, release, hide, leave, disable, deactivate, opt-out; XML wiring PASS\n";
}
'''
with tempfile.TemporaryDirectory(prefix='piflex-workflow-widgets-') as directory:
    d=Path(directory);(d/'test.cpp').write_text(source)
    flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','Qt6Widgets'],text=True))
    subprocess.run(['c++','-std=c++20','-fPIC','-I'+str(ROOT/'src'),str(d/'test.cpp'),
                    fpclassify_object(d),'-o',str(d/'test'),*flags],check=True)
    subprocess.run([str(d/'test')],check=True,timeout=20,
                   env={**os.environ,'QT_QPA_PLATFORM':'offscreen'})
