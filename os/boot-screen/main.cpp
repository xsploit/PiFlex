#include <QApplication>
#include <QElapsedTimer>
#include <QFile>
#include <QDir>
#include <QFontDatabase>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPainter>
#include <QProcess>
#include <QSvgRenderer>
#include <QTimer>
#include <QWidget>
#include <cmath>

static bool hasApp(const QJsonObject& node, const QString& appId) {
    if (node.value("app_id").toString() == appId) return true;
    for (const auto& key : {"nodes", "floating_nodes"})
        for (const auto& child : node.value(key).toArray())
            if (hasApp(child.toObject(), appId)) return true;
    return false;
}

class BootScreen final : public QWidget {
    QSvgRenderer logo;
    QElapsedTimer clock;
    QTimer animation, poll;
    QProcess tree;
    QString label = "STARTING DISPLAY";
    double progress = 0.82;
    bool preview, finishing = false;
public:
    explicit BootScreen(bool isPreview, const QString& assets)
        : logo(assets + "/piflex-logo.svg"), preview(isPreview) {
        setWindowTitle("PiFlex startup");
        setWindowFlag(Qt::FramelessWindowHint);
        setCursor(Qt::BlankCursor);
        const int fontId = QFontDatabase::addApplicationFont(assets + "/Ubuntu-R.ttf");
        if (fontId >= 0) setFont(QFont(QFontDatabase::applicationFontFamilies(fontId).first()));
        clock.start();
        animation.setInterval(33);
        connect(&animation, &QTimer::timeout, this, [this] { update(); });
        animation.start();
        tree.setProgram("swaymsg");
        tree.setArguments({"-t", "get_tree", "-r"});
        connect(&tree, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), this,
                [this](int code, QProcess::ExitStatus) {
            if (code != 0 || finishing) return;
            const auto doc = QJsonDocument::fromJson(tree.readAllStandardOutput());
            if (hasApp(doc.object(), "foot")) { qApp->quit(); return; }
            if (!hasApp(doc.object(), "org.mixxx.Mixxx")) return;
            qInfo("PiFlex startup: deck window mapped; handing over");
            finishing = true;
            label = "OPENING DECKS";
            progress = 1.0;
            update();
            QTimer::singleShot(180, qApp, &QApplication::quit);
        });
        poll.setInterval(300);
        connect(&poll, &QTimer::timeout, this, [this] {
            if (preview || finishing) return;
            const QString runtime = qEnvironmentVariable("XDG_RUNTIME_DIR");
            QFile pid(runtime + "/pflx-bitedj.pid");
            if (pid.open(QIODevice::ReadOnly)) {
                bool valid = false;
                const auto supervisor = pid.readAll().trimmed().toLongLong(&valid);
                if (valid && supervisor > 1) {
                    QFile cmd(QString("/proc/%1/cmdline").arg(supervisor));
                    if (cmd.open(QIODevice::ReadOnly) && cmd.readAll().contains("pflx-bitedj-supervisor")) {
                        label = "STARTING BITEDJ";
                        progress = 0.88;
                        QFile children(QString("/proc/%1/task/%1/children").arg(supervisor));
                        if (children.open(QIODevice::ReadOnly)) {
                            for (const auto& child : children.readAll().trimmed().split(' ')) {
                                bool childValid = false;
                                const auto id = child.toLongLong(&childValid);
                                if (!childValid || id < 2) continue;
                                QFile name(QString("/proc/%1/comm").arg(id));
                                if (name.open(QIODevice::ReadOnly) && name.readAll().trimmed() == "mixxx") {
                                    label = "LOADING DECK INTERFACE";
                                    progress = 0.95;
                                }
                            }
                        }
                    }
                }
            }
            if (clock.elapsed() > 20000) label = "STILL STARTING BITEDJ";
            if (tree.state() == QProcess::NotRunning) tree.start();
        });
        poll.start();
        // Never hide recovery or block startup indefinitely. This process is
        // visual only: it does not own, restart, or terminate the audio app.
        QTimer::singleShot(preview ? 12000 : 60000, qApp, &QApplication::quit);
        if (preview) { label = "STARTUP PREVIEW"; progress = 0.58; }
    }
    ~BootScreen() override {
        if (tree.state() != QProcess::NotRunning) { tree.kill(); tree.waitForFinished(1000); }
    }
protected:
    void paintEvent(QPaintEvent*) override {
        QPainter p(this);
        p.setRenderHint(QPainter::Antialiasing);
        p.fillRect(rect(), QColor("#080b10"));
        const double scale = std::min(width() / 1920.0, height() / 1200.0);
        p.translate(width() / 2.0, height() / 2.0);
        p.scale(scale, scale);
        logo.render(&p, QRectF(-405, -150, 810, 144));
        QFont f = font();
        f.setPixelSize(16);
        f.setLetterSpacing(QFont::AbsoluteSpacing, 5.0);
        p.setFont(f);
        p.setPen(QColor("#6d7788"));
        p.drawText(QRectF(-430, 2, 860, 30), Qt::AlignCenter, "PERFORMANCE SYSTEM");
        const QRectF track(-330, 105, 660, 4);
        p.setPen(Qt::NoPen);
        p.setBrush(QColor("#202936"));
        p.drawRoundedRect(track, 2, 2);
        p.setBrush(QColor("#279cff"));
        p.drawRoundedRect(QRectF(track.x(), track.y(), track.width() * progress, 4), 2, 2);
        if (!finishing) {
            // A moving glint communicates activity; the filled amount advances
            // only at observed startup stages, not from an invented percentage.
            const double span = track.width() * progress;
            const double phase = (std::sin(clock.elapsed() / 700.0) + 1) / 2;
            p.setBrush(QColor("#b9e2ff"));
            p.drawRoundedRect(QRectF(track.x() + phase * (span - 28), track.y(), 28, 4), 2, 2);
        }
        f.setPixelSize(18);
        f.setLetterSpacing(QFont::AbsoluteSpacing, 2.3);
        p.setFont(f);
        p.setPen(QColor("#b5c0d0"));
        p.drawText(QRectF(-450, 137, 900, 34), Qt::AlignCenter, label);
    }
};

int main(int argc, char** argv) {
    QApplication app(argc, argv);
    app.setDesktopFileName("org.piflex.BootScreen");
    const QStringList args = app.arguments();
    QString assets = qEnvironmentVariable("PIFLEX_BOOT_ASSETS", "/usr/local/share/piflex/boot");
    const int exportAt = args.indexOf("--export-plymouth");
    if (exportAt >= 0 && exportAt + 1 < args.size()) {
        QDir dir(args[exportAt + 1]);
        if (!dir.mkpath(".")) return 1;
        QSvgRenderer renderer(assets + "/piflex-logo.svg");
        if (!renderer.isValid()) return 1;
        QImage logo(810, 144, QImage::Format_ARGB32_Premultiplied);
        logo.fill(Qt::transparent);
        { QPainter p(&logo); renderer.render(&p); }
        QImage blue(1, 1, QImage::Format_ARGB32);
        blue.fill(QColor("#279cff"));
        QImage track(1, 1, QImage::Format_ARGB32);
        track.fill(QColor("#202936"));
        return logo.save(dir.filePath("logo.png")) && blue.save(dir.filePath("blue.png"))
            && track.save(dir.filePath("track.png")) ? 0 : 1;
    }
    BootScreen screen(args.contains("--preview"), assets);
    const int snapshot = args.indexOf("--snapshot");
    if (snapshot >= 0 && snapshot + 1 < args.size()) {
        screen.resize(1920, 1200);
        return screen.grab().save(args[snapshot + 1]) ? 0 : 1;
    }
    screen.showFullScreen();
    return app.exec();
}
