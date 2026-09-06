"""Exercise the production search key handler with real Qt key delivery.

The surrounding search/database operations are counters; the keyboard handler
itself is extracted unchanged, including the focus-transfer decision.
"""
from pathlib import Path
import argparse
import os
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--revision', help='Test a Git revision instead of the working file')
args = parser.parse_args()
text = (subprocess.check_output(
    ['git', 'show', f'{args.revision}:src/widget/wsearchlineedit.cpp'], cwd=ROOT, text=True)
    if args.revision else (ROOT / 'src/widget/wsearchlineedit.cpp').read_text())
start = text.index('void WSearchLineEdit::keyPressEvent(')
end = text.index('\nvoid WSearchLineEdit::focusInEvent(', start)
handler = text[start:end]
source = r'''
#include <QApplication>
#include <QAbstractItemView>
#include <QComboBox>
#include <QKeyEvent>
#include <QLineEdit>
#include <QPushButton>
#include <QVBoxLayout>
#include <cassert>
enum class FocusWidget { TracksTable };
class WSearchLineEdit : public QComboBox {
public:
    using QComboBox::QComboBox;
    bool m_queryEmitted = false;
    bool s_historyShortcutsEnabled = true;
    int queries = 0, transfers = 0;
    QWidget* tracks = nullptr;
    void keyPressEvent(QKeyEvent*) override;
    void setLibraryFocus(FocusWidget) { ++transfers; tracks->setFocus(); }
    void slotTriggerSearch() { ++queries; m_queryEmitted = true; }
    void triggerSearchDebounced() {}
    void deleteSelectedListItem() {}
    void slotSaveSearch() {}
    void slotClearSearch() { lineEdit()->clear(); }
    bool slotClearSearchIfClearButtonHasFocus() { return false; }
    bool hasSelectedText() const { return lineEdit()->hasSelectedText(); }
    int findCurrentTextIndex() { return findText(currentText()); }
};
''' + handler + r'''
int main(int argc, char** argv) {
    QApplication app(argc, argv);
    QWidget window;
    QVBoxLayout layout(&window);
    WSearchLineEdit search;
    QPushButton track("Load selected track");
    int loads = 0;
    QObject::connect(&track, &QPushButton::clicked, [&] { ++loads; });
    search.tracks = &track;
    search.setEditable(true);
    layout.addWidget(&search); layout.addWidget(&track);
    window.show(); search.setFocus(); app.processEvents();
    for (bool alreadySearched : {false, true}) {
        for (int key : {int(Qt::Key_Return), int(Qt::Key_Enter)}) {
            search.setEditText("fallout");
            search.lineEdit()->deselect();
            search.m_queryEmitted = alreadySearched;
            search.setFocus(); app.processEvents();
            int before = search.queries;
            for (int n = 0; n < 5; ++n) {
                QKeyEvent press(QEvent::KeyPress, key, Qt::NoModifier,
                        "\r", n > 0, 1);
                QApplication::sendEvent(QApplication::focusWidget(), &press);
                QKeyEvent release(QEvent::KeyRelease, key, Qt::NoModifier);
                QApplication::sendEvent(QApplication::focusWidget(), &release);
                app.processEvents();
                assert(search.transfers == 0);
                assert(search.hasFocus() || search.lineEdit()->hasFocus());
                assert(loads == 0);
            }
            assert(search.queries > before);
            assert(search.currentText() == "fallout");
        }
    }
    search.lineEdit()->selectAll();
    QKeyEvent completed(QEvent::KeyPress, Qt::Key_Return, Qt::NoModifier);
    QApplication::sendEvent(QApplication::focusWidget(), &completed);
    assert(search.transfers == 0 && loads == 0);
    // Explicit navigation still works; only search submission loses auto-jump.
    QKeyEvent escape(QEvent::KeyPress, Qt::Key_Escape, Qt::NoModifier);
    QApplication::sendEvent(QApplication::focusWidget(), &escape);
    assert(search.transfers == 1);
}
'''
with tempfile.TemporaryDirectory(prefix='pflx-search-submit-') as directory:
    cpp = Path(directory) / 'test.cpp'
    cpp.write_text(source)
    exe = Path(directory) / 'test'
    flags = shlex.split(subprocess.check_output(
        ['pkg-config', '--cflags', '--libs', 'Qt6Widgets'], text=True))
    subprocess.run(['c++', '-std=c++20', '-fPIC', str(cpp), '-o', str(exe), *flags], check=True)
    subprocess.run([str(exe)], check=True,
        env={**os.environ, 'QT_QPA_PLATFORM': 'offscreen'})
print('Search submit: Return/Enter, pending/completed queries, repeats and selection retain search focus; Escape navigates explicitly.')
