#pragma once

#include <QApplication>
#include <QAbstractSpinBox>
#include <QComboBox>
#include <QEvent>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QProcess>
#include <QStandardPaths>
#include <QTextEdit>
#include <QTimer>

#include "control/controlproxy.h"
#include "preferences/usersettings.h"

#ifdef __linux__
#include <csignal>
#endif

// One owned Wayland keyboard for all editable widgets, including dialog and
// combo-box editors. Event driven: no focus polling and no audio-thread work.
class TouchKeyboard final : public QObject {
  public:
    TouchKeyboard(UserSettingsPointer config, QObject* parent)
            : QObject(parent), m_config(std::move(config)),
              m_enabled("[BiteDJ]", "touch_keyboard") {
        if (!QGuiApplication::platformName().startsWith("wayland")) return;
        m_program = QStandardPaths::findExecutable("wvkbd-mobintl");
        if (m_program.isEmpty()) return;
        m_process.setStandardOutputFile(QProcess::nullDevice());
        m_process.setStandardErrorFile(QProcess::nullDevice());
        connect(qApp, &QApplication::focusChanged, this,
                [this](QWidget*, QWidget*) { schedule(); });
        connect(&m_enabled, &ControlProxy::valueChanged, this,
                [this](double) { schedule(); });
        connect(&m_process, &QProcess::started, this, [this] {
            // Let wvkbd install its signal handlers before sending show/hide.
            QTimer::singleShot(150, this, [this] { m_ready = true; synchronize(); });
        });
        connect(&m_process, qOverload<int, QProcess::ExitStatus>(&QProcess::finished),
                this, [this](int, QProcess::ExitStatus) { m_ready = false; });
        qApp->installEventFilter(this);
    }

    ~TouchKeyboard() override {
        // The process belongs to this instance, never kill a user's keyboard.
        if (m_process.state() != QProcess::NotRunning) {
            m_process.terminate();
            if (!m_process.waitForFinished(300)) {
                m_process.kill();
                m_process.waitForFinished(300);
            }
        }
    }

    static bool isTextEditor(QWidget* widget) {
        if (!widget || !widget->isEnabled() || !widget->isVisible()) return false;
        if (auto* combo = qobject_cast<QComboBox*>(widget)) {
            return combo->isEditable() && isTextEditor(combo->lineEdit());
        }
        if (auto* spin = qobject_cast<QAbstractSpinBox*>(widget)) return !spin->isReadOnly();
        if (auto* edit = qobject_cast<QLineEdit*>(widget)) return !edit->isReadOnly();
        if (auto* edit = qobject_cast<QTextEdit*>(widget)) return !edit->isReadOnly();
        if (auto* edit = qobject_cast<QPlainTextEdit*>(widget)) return !edit->isReadOnly();
        return false;
    }

  protected:
    bool eventFilter(QObject*, QEvent* event) override {
        // A second tap reopens a manually hidden keyboard without needing a
        // focus change. Defer until Qt has delivered the tap/focus event.
        if (event->type() == QEvent::MouseButtonRelease ||
                event->type() == QEvent::TouchEnd || event->type() == QEvent::Hide) schedule();
        return false;
    }

  private:
    void schedule() {
        if (m_scheduled || m_program.isEmpty()) return;
        m_scheduled = true;
        QTimer::singleShot(0, this, [this] {
            m_scheduled = false;
            synchronize();
        });
    }
    void synchronize() {
        const bool show = m_config->getValue<int>(
                                  ConfigKey("[BiteDJ]", "touch_keyboard"), 1) == 1 &&
                isTextEditor(QApplication::focusWidget());
        if (m_process.state() == QProcess::NotRunning) {
            if (show) {
                m_ready = false;
                m_process.start(m_program, {"-H", "320", "-L", "320"});
            }
            return;
        }
#ifdef __linux__
        if (m_ready && m_process.state() == QProcess::Running) {
            ::kill(static_cast<pid_t>(m_process.processId()), show ? SIGUSR2 : SIGUSR1);
        }
#endif
    }
    UserSettingsPointer m_config;
    ControlProxy m_enabled;
    QProcess m_process;
    QString m_program;
    bool m_scheduled = false;
    bool m_ready = false;
};
