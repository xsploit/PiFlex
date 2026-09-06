"""Production header serialization/restoration in Qt6 with the real protobuf.

Track settings and column policy are fixture adapters. This does not replace
LibraryColumnControlTest (real SQL model / real managed widths) or Pi touch QA.
"""
from pathlib import Path
import os
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
text = (ROOT / 'src/widget/wtracktableviewheader.cpp').read_text()
header = (ROOT / 'src/widget/wtracktableviewheader.h').read_text()


def function(signature):
    start = text.index(signature)
    cursor = text.index('{', start) + 1
    depth = 1
    while depth:
        depth += (text[cursor] == '{') - (text[cursor] == '}')
        cursor += 1
    return text[start:cursor]


source = r'''
#include <QtWidgets>
#include <QScopedValueRollback>
#include <cassert>
#include <iostream>
#include "proto/headers.pb.h"
#define DEBUG_ASSERT(x) assert(x)
#define WTTVH_MINIMUM_SECTION_SIZE 20
#define math_min std::min
#define math_max std::max
class TrackModel {
public:
    static constexpr int kHeaderWidthRole=Qt::UserRole, kHeaderNameRole=Qt::UserRole+1;
    QMap<QString,QString> settings;
    int writes=0;
    virtual ~TrackModel()=default;
    QString getModelSetting(const QString& key){return settings.value(key);}
    void setModelSetting(const QString& key,const QString& value){settings[key]=value;++writes;}
    bool isColumnHiddenByDefault(int i){return i==4;}
};
class WTrackTableViewHeader;
class LibraryColumnControl {
public:
    static LibraryColumnControl* active;
    static LibraryColumnControl* tryInstance(){return active;}
    void registerHeader(WTrackTableViewHeader*){}
    void unregisterHeader(WTrackTableViewHeader*){}
    void applyTo(WTrackTableViewHeader*);
};
LibraryColumnControl* LibraryColumnControl::active=nullptr;
class WTrackTableViewHeader : public QHeaderView {
public:
    QMenu m_menu;
    QMap<int,int> m_hiddenColumnSizes;
    bool m_restoringHeaderState=false;
    WTrackTableViewHeader(Qt::Orientation,QWidget*);
    ~WTrackTableViewHeader()override;
    TrackModel* getTrackModel();
    int getWidthOfHiddenColumn(int)const;
    void saveHeaderState();void restoreHeaderState();void loadDefaultHeaderState();
    void slotReapplyColumnControl();void slotSaveColumnOrder();
};
void LibraryColumnControl::applyTo(WTrackTableViewHeader*h){
    h->setSectionHidden(0,true);h->setSectionHidden(3,true);
    h->showSection(1);h->showSection(2);
    h->resizeSection(1,120);h->resizeSection(2,240);
}
'''
source += header[header.index('class HeaderViewState {'):header.index('class WTrackTableViewHeader :')]
source += text[text.index('HeaderViewState::HeaderViewState('):text.index('WTrackTableViewHeader::WTrackTableViewHeader(')]
for name in ('WTrackTableViewHeader::WTrackTableViewHeader(',
             'WTrackTableViewHeader::~WTrackTableViewHeader(',
             'TrackModel* WTrackTableViewHeader::getTrackModel(',
             'int WTrackTableViewHeader::getWidthOfHiddenColumn(',
             'void WTrackTableViewHeader::saveHeaderState(',
             'void WTrackTableViewHeader::restoreHeaderState(',
             'void WTrackTableViewHeader::loadDefaultHeaderState(',
             'void WTrackTableViewHeader::slotReapplyColumnControl(',
             'void WTrackTableViewHeader::slotSaveColumnOrder('):
    source += function(name) + '\n'
source += r'''
class Model : public QStandardItemModel, public TrackModel {
public:
    Model():QStandardItemModel(3,5){
        QStringList names={"track_id","artist","title","preview","year"};
        for(int i=0;i<5;++i){
            setHeaderData(i,Qt::Horizontal,names[i],kHeaderNameRole);
            setHeaderData(i,Qt::Horizontal,names[i],Qt::DisplayRole);
            setHeaderData(i,Qt::Horizontal,90,kHeaderWidthRole);
        }
    }
};
int main(int argc,char**argv){
    QApplication app(argc,argv);LibraryColumnControl control;
    LibraryColumnControl::active=&control;
    Model model;WTrackTableViewHeader h(Qt::Horizontal,nullptr);
    h.setModel(&model);h.restoreHeaderState();
    assert(h.isSectionHidden(0)&&h.isSectionHidden(3)&&h.isSectionHidden(4));
    h.setSectionsMovable(true);h.setSectionResizeMode(QHeaderView::Fixed);
    h.resizeSection(2,37);h.moveSection(h.visualIndex(2),h.visualIndex(1));
    auto saved=model.getModelSetting("header_state_pb");
    assert(!saved.isEmpty()&&model.writes==1);
    // Fresh model and header from serialized settings, not retained Qt state.
    Model fresh;fresh.settings=model.settings;
    WTrackTableViewHeader restored(Qt::Horizontal,nullptr);
    restored.setModel(&fresh);restored.restoreHeaderState();
    assert(restored.visualIndex(2)==1);
    assert(restored.sectionSize(2)==240);
    assert(restored.isSectionHidden(0)&&restored.isSectionHidden(3)&&restored.isSectionHidden(4));
    assert(fresh.writes==0&&fresh.getModelSetting("header_state_pb")==saved);
    restored.slotReapplyColumnControl();assert(restored.visualIndex(2)==1);
    restored.moveSection(restored.visualIndex(1),0);assert(fresh.writes==1);
    assert(model.getModelSetting("header_state_pb")==saved);
    // Exercise Qt's actual header drag events, not only moveSection calls.
    Model gesture;WTrackTableViewHeader drag(Qt::Horizontal,nullptr);
    drag.setModel(&gesture);drag.restoreHeaderState();
    drag.setSectionsMovable(true);drag.setSectionResizeMode(QHeaderView::Fixed);
    drag.resize(500,40);drag.show();QApplication::processEvents();
    const int originalIndex=drag.visualIndex(1);
    const auto mouse=[&](QEvent::Type type,int x,Qt::MouseButton button,Qt::MouseButtons buttons){
        QPointF p(x,15);QMouseEvent event(type,p,p,button,buttons,Qt::NoModifier);
        QApplication::sendEvent(drag.viewport(),&event);QApplication::processEvents();
    };
    mouse(QEvent::MouseButtonPress,60,Qt::LeftButton,Qt::LeftButton);
    for(int x=80;x<=330;x+=10)mouse(QEvent::MouseMove,x,Qt::NoButton,Qt::LeftButton);
    mouse(QEvent::MouseButtonRelease,330,Qt::LeftButton,Qt::NoButton);
    assert(drag.visualIndex(1)!=originalIndex);
    assert(gesture.writes>0&&!gesture.getModelSetting("header_state_pb").isEmpty());
    // Invalid stored state falls back to safe defaults and managed hiding.
    Model corrupt;corrupt.settings["header_state_pb"]="not-a-protobuf";
    WTrackTableViewHeader fallback(Qt::Horizontal,nullptr);
    fallback.setModel(&corrupt);fallback.restoreHeaderState();
    assert(fallback.isSectionHidden(0)&&fallback.isSectionHidden(3));
    assert(fallback.sectionSize(2)==240&&corrupt.writes==0);
    // No LibraryColumnControl: retain the upstream pixel-width restore path.
    LibraryColumnControl::active=nullptr;
    Model stock;stock.settings=model.settings;
    WTrackTableViewHeader plain(Qt::Horizontal,nullptr);
    plain.setModel(&stock);plain.restoreHeaderState();
    assert(plain.visualIndex(2)==1&&plain.sectionSize(2)==37);
    std::cout<<"Header: mouse drag, protobuf order persistence, no restore-time writes, managed policy override, model isolation, corrupt state fallback, unmanaged compatibility PASS\n";
}
'''
table = (ROOT / 'src/widget/wtracktableview.cpp').read_text()
assert 'header->setSectionsMovable(true);' in table
assert 'header->setSectionsMovable(!columnControlActive)' not in table
assert 'header->setSectionResizeMode(QHeaderView::Fixed);' in table
with tempfile.TemporaryDirectory(prefix='bitedj-browser-columns-') as directory:
    d = Path(directory)
    subprocess.run(['protoc', '-I' + str(ROOT / 'src'), '--cpp_out=' + str(d),
                    str(ROOT / 'src/proto/headers.proto')], check=True)
    (d / 'test.cpp').write_text(source)
    flags = shlex.split(subprocess.check_output(
        ['pkg-config', '--cflags', '--libs', 'Qt6Widgets', 'protobuf-lite'], text=True))
    subprocess.run(['c++', '-std=c++20', '-fPIC', '-I' + str(d),
                    str(d / 'test.cpp'), str(d / 'proto/headers.pb.cc'),
                    '-o', str(d / 'test'), *flags], check=True)
    subprocess.run([str(d / 'test')], check=True, timeout=20,
                   env={**os.environ, 'QT_QPA_PLATFORM': 'offscreen'})
