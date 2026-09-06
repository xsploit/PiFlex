"""Production load-policy header with fixture controls/settings and real FP boundary."""
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
from native_test_support import fpclassify_object

ROOT=Path(__file__).resolve().parents[2]
ENUM=re.search(r'enum class LoadWhenDeckPlaying \{.*?\};',
    (ROOT/'src/preferences/dialog/dlgprefdeck.h').read_text(),re.S).group()
STUB=r'''
#pragma once
#include <QString>
#include <QMap>
#include <memory>
struct ConfigKey {
    QString group,item;
    ConfigKey(QString g,QString i):group(g),item(i){}
    QString text() const {return group+item;}
};
class ControlObject {
 public:
    double value=0;
    static inline QMap<QString,ControlObject*> controls;
    double get() const {return value;}
    static ControlObject* getControl(ConfigKey k){return controls.value(k.text(),nullptr);}
    static double get(ConfigKey k){auto* c=getControl(k);return c?c->value:0;}
};
struct Settings {
    QMap<QString,int> values;
    bool exists(ConfigKey key) const{return values.contains(key.text());}
    template<class T> T getValue(ConfigKey key,T fallback) const {
        return exists(key)?static_cast<T>(values[key.text()]):fallback;
    }
};
using UserSettingsPointer=std::shared_ptr<Settings>;
'''
SOURCE=r'''
#include "mixer/deckloadpolicy.h"
#include <cassert>
#include <iostream>
int main(){
    auto config=std::make_shared<Settings>();
    ControlObject play,volume,route;
    const QString g="[Channel1]";
    ControlObject::controls[g+"play"]=&play;
    ControlObject::controls[g+"volume"]=&volume;
    ControlObject::controls[g+"main_mix"]=&route;
    route.value=1; volume.value=1; play.value=1;
    assert(mixxx::deckload::policy(config)==LoadWhenDeckPlaying::AllowIfChannelClosed);
    assert(!mixxx::deckload::allowed(g,config));
    volume.value=0; assert(mixxx::deckload::allowed(g,config));
    volume.value=0.001; assert(!mixxx::deckload::allowed(g,config));
    volume.value=-1; assert(!mixxx::deckload::allowed(g,config));
    volume.value=util_double_nan(); assert(!mixxx::deckload::allowed(g,config));
    volume.value=util_double_infinity(); assert(!mixxx::deckload::allowed(g,config));
    volume.value=1; route.value=0; assert(mixxx::deckload::allowed(g,config));
    route.value=1; play.value=0; assert(mixxx::deckload::allowed(g,config));
    play.value=1;
    ControlObject::controls.remove(g+"volume"); ControlObject::controls.remove(g+"main_mix");
    assert(!mixxx::deckload::allowed(g,config));
    for(int policy:{0,1,2,3,99}){
        config->values[kConfigKeyLoadWhenDeckPlaying.text()]=policy;
        assert(mixxx::deckload::allowed(g,config)==(policy==1||policy==2));
    }
    config->values.clear();
    config->values[kConfigKeyAllowTrackLoadToPlayingDeck.text()]=1;
    assert(mixxx::deckload::allowed(g,config));
    config->values[kConfigKeyAllowTrackLoadToPlayingDeck.text()]=0;
    assert(!mixxx::deckload::allowed(g,config));
    assert(mixxx::deckload::allowed("[PreviewDeck1]",config));
    ControlObject::controls.remove(g+"play");
    assert(!mixxx::deckload::allowed(g,config));
    ControlObject::controls[g+"play"]=&play;
    play.value=util_double_nan(); assert(!mixxx::deckload::allowed(g,config));
    std::cout << "deck policy: fresh default, live/fader/route, missing controls, invalid floats, modes and legacy settings PASS\n";
}
'''
with tempfile.TemporaryDirectory(prefix='piflex-load-policy-') as directory:
    d=Path(directory)
    (d/'control').mkdir(); (d/'preferences/dialog').mkdir(parents=True)
    (d/'control/controlobject.h').write_text(STUB)
    (d/'preferences/dialog/dlgprefdeck.h').write_text('#pragma once\n'+ENUM+r'''
const ConfigKey kConfigKeyLoadWhenDeckPlaying("[Controls]","LoadWhenDeckPlaying");
const ConfigKey kConfigKeyAllowTrackLoadToPlayingDeck("[Controls]","AllowTrackLoadToPlayingDeck");
constexpr auto kDefaultLoadWhenDeckPlaying=LoadWhenDeckPlaying::AllowIfChannelClosed;
''')
    (d/'test.cpp').write_text(SOURCE)
    flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','Qt6Core'],text=True))
    subprocess.run(['c++','-std=c++20','-ffast-math','-fPIC','-I'+str(d),'-I'+str(ROOT/'src'),
                    str(d/'test.cpp'),fpclassify_object(d),'-o',str(d/'test'),*flags],check=True)
    subprocess.run([str(d/'test')],check=True)
