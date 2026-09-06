"""Exercise the production editable-focus classifier against actual Qt widgets."""
from pathlib import Path
import os
import shlex
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[2]
header=(ROOT/'src/widget/touchkeyboard.h').read_text()
start=header.index('    static bool isTextEditor(')
end=header.index('\n  protected:',start)
source=r'''
#include <QApplication>
#include <QLineEdit>
#include <QComboBox>
#include <QSpinBox>
#include <QTextEdit>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QVBoxLayout>
#include <cassert>
class Classifier { public:
'''+header[start:end]+r'''
};
int main(int argc,char** argv) {
    QApplication app(argc,argv);
    QWidget window;
    QVBoxLayout layout(&window);
    QLineEdit line;
    QComboBox search;
    search.setEditable(true);
    QComboBox selection;
    QSpinBox port;
    QTextEdit rich;
    QPlainTextEdit plain;
    QPushButton button("Play");
    for(auto* w : QList<QWidget*>{&line,&search,&selection,&port,&rich,&plain,&button}) layout.addWidget(w);
    window.show(); app.processEvents();
    auto check=[](QWidget* w,bool expected) { assert(Classifier::isTextEditor(w)==expected); };
    check(nullptr,false); check(&line,true); check(&search,true); check(search.lineEdit(),true);
    check(&selection,false); check(&port,true); check(&rich,true); check(&plain,true); check(&button,false);
    line.setEchoMode(QLineEdit::Password); check(&line,true);
    line.setReadOnly(true);check(&line,false);
    search.lineEdit()->setReadOnly(true);check(&search,false);
    port.setReadOnly(true);check(&port,false);
    rich.setReadOnly(true);check(&rich,false);
    plain.setReadOnly(true);check(&plain,false);
    line.setReadOnly(false);line.setEnabled(false);check(&line,false);
    line.setEnabled(true);line.hide();check(&line,false);
    search.lineEdit()->setReadOnly(false);search.setFocus();app.processEvents();
    check(QApplication::focusWidget(),true); // actual editable search focus proxy
}
'''
with tempfile.TemporaryDirectory(prefix='pflx-touch-keyboard-') as directory:
    cpp=Path(directory)/'test.cpp';cpp.write_text(source)
    exe=Path(directory)/'test'
    flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','Qt6Widgets'],text=True))
    subprocess.run(['c++','-std=c++20','-fPIC',str(cpp),'-o',str(exe),*flags],check=True)
    subprocess.run([str(exe)],check=True,env={**os.environ,'QT_QPA_PLATFORM':'offscreen'})
print('Touch keyboard: real search focus, passwords, multiline, numeric editors, readonly/disabled/hidden exclusions passed.')
