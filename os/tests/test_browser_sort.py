"""Run production selection-restoration methods against real Qt sorted tables.

The fixture substitutes only track-model identity/position lookup, not table
sorting, selection or scrolling. Requires Linux Qt6Widgets development packages.
"""
from pathlib import Path
import os
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
text = (ROOT / 'src/widget/wtracktableview.cpp').read_text()


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
#include <algorithm>
#include <cassert>
#include <iostream>
#define VERIFY_OR_DEBUG_ASSERT(x) if (!(x))
using TrackId = int;
struct TrackModel {
    enum class Capability {Reorder};
    bool positions = false;
    virtual ~TrackModel() = default;
    bool hasCapabilities(Capability) const {return positions;}
    virtual QList<int> getSelectedPositions(const QModelIndexList&) = 0;
    virtual int getTrackRowByPosition(int) = 0;
    virtual QList<int> getTrackRows(TrackId) = 0;
};
struct Row {int id, position, bpm;};
class Model : public QAbstractTableModel, public TrackModel {
public:
    QList<Row> rows;
    Model(bool duplicate) {
        positions = duplicate;
        for(int i=0;i<200;++i) rows.append({i+1,i+1,80+i%100});
        rows[0].bpm=140;
        if(duplicate) rows[1].id=rows[0].id;
    }
    int rowCount(const QModelIndex& = {})const override {return rows.size();}
    int columnCount(const QModelIndex& = {})const override {return 3;}
    QVariant data(const QModelIndex& i,int role=Qt::DisplayRole)const override {
        if(!i.isValid()||role!=Qt::DisplayRole)return {};
        return i.column()==2 ? rows[i.row()].bpm : rows[i.row()].id;
    }
    void sort(int col,Qt::SortOrder order)override {
        beginResetModel();
        std::stable_sort(rows.begin(),rows.end(),[=](const Row&a,const Row&b){
            int x=col==2?a.bpm:a.id,y=col==2?b.bpm:b.id;
            return order==Qt::AscendingOrder?x<y:x>y;
        });
        endResetModel();
    }
    QList<int> getSelectedPositions(const QModelIndexList& indices)override {
        QList<int> out;for(auto i:indices)out.append(rows[i.row()].position);return out;
    }
    int getTrackRowByPosition(int pos)override {
        for(int i=0;i<rows.size();++i)if(rows[i].position==pos)return i;return -1;
    }
    QList<int> getTrackRows(TrackId id)override {
        QList<int> out;for(int i=0;i<rows.size();++i)if(rows[i].id==id)out.append(i);return out;
    }
};
class WTrackTableView : public QTableView {
public:
    bool m_sorting=true;
    TrackModel* getTrackModel(){return dynamic_cast<TrackModel*>(model());}
    QList<TrackId> getSelectedTrackIds(){
        QList<TrackId> ids;
        for(auto i:selectionModel()->selectedRows())ids.append(model()->data(i).toInt());
        return ids;
    }
    void doSortByColumn(int,Qt::SortOrder);
    void selectTracksByPosition(const QList<int>&,int);
    void selectTracksById(const QList<TrackId>&,int);
};
'''
for name in ('void WTrackTableView::doSortByColumn(',
             'void WTrackTableView::selectTracksByPosition(',
             'void WTrackTableView::selectTracksById('):
    source += function(name) + '\n'
source += r'''
int main(int argc,char**argv){
    QApplication app(argc,argv);
    for(bool duplicate:{false,true}){
        Model model(duplicate);WTrackTableView view;
        view.setModel(&model);view.resize(440,230);
        view.setSelectionBehavior(QAbstractItemView::SelectRows);
        view.show();QApplication::processEvents();view.selectRow(0);
        for(auto order:{Qt::AscendingOrder,Qt::DescendingOrder}){
            view.doSortByColumn(2,order);QApplication::processEvents();
            assert(view.selectionModel()->selectedRows().size()==1);
            int row=view.currentIndex().row();assert(row>=0);
            assert(model.rows[row].position==1 && model.rows[row].bpm==140);
            assert(view.viewport()->rect().intersects(view.visualRect(model.index(row,0))));
            assert((row>0 && model.rows[row-1].bpm==140) ||
                   (row+1<model.rows.size() && model.rows[row+1].bpm==140));
        }
    }
    std::cout<<"BPM sort: ascending/descending, same track selected and visible, 140 BPM neighbors, duplicate playlist positions PASS\n";
}
'''
with tempfile.TemporaryDirectory(prefix='bitedj-browser-sort-') as directory:
    d = Path(directory)
    (d / 'test.cpp').write_text(source)
    flags = shlex.split(subprocess.check_output(
        ['pkg-config', '--cflags', '--libs', 'Qt6Widgets'], text=True))
    subprocess.run(['c++', '-std=c++20', '-fPIC', str(d / 'test.cpp'),
                    '-o', str(d / 'test'), *flags], check=True)
    subprocess.run([str(d / 'test')], check=True, timeout=20,
                   env={**os.environ, 'QT_QPA_PLATFORM': 'offscreen'})
