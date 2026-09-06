// Parse the actual Pad FX skin using the native parser and click its controls.
// A temporary wrapper omits unrelated players/audio so this never opens a DJ session.
#include <QApplication>
#include <QFile>
#include <QDir>
#include <QScrollArea>
#include <QTemporaryDir>
#include <QtTest/QTest>
#include <iostream>
#include <stdexcept>

#include "control/control.h"
#include "control/controlobject.h"
#include "controllers/controllermanager.h"
#include "controllers/keyboard/keyboardeventfilter.h"
#include "preferences/padfxsettings.h"
#include "skin/legacy/legacyskinparser.h"
#include <QComboBox>
#include <QPushButton>
#include <QFrame>

void require(bool value, const char* message) {
    if (!value) { throw std::runtime_error(message); }
}
int main(int argc, char** argv) {
    QApplication app(argc, argv);
    require(argc >= 2, "expected repository path");
    const QString root = QString::fromLocal8Bit(argv[1]);
    QTemporaryDir dir;
    require(dir.isValid(), "temporary skin");
    require(QDir().mkpath(dir.filePath("icons")), "fixture icon directory");
    require(QFile::copy(root + "/res/skins/BiteDJ/icons/dropdown_arrow.svg",
                    dir.filePath("icons/dropdown_arrow.svg")), "dropdown arrow asset");
    for (const auto* name : {"padfx-settings.xml", "style.qss"}) {
        require(QFile::copy(root + "/res/skins/BiteDJ/" + name, dir.filePath(name)), "copy current skin fixture");
    }
    QFile file(dir.filePath("skin.xml"));
    require(file.open(QIODevice::WriteOnly), "open wrapper");
    file.write(R"(<skin><manifest><title>Pad FX test</title></manifest>
<ObjectName>Mixxx</ObjectName><Style src="skin:style.qss"/><Layout>vertical</Layout>
<Children><WidgetStack currentpage="[PadTest],current"><Children>
<WidgetGroup trigger="[PadTest],blank"><Children><Label><Text>Blank</Text></Label></Children></WidgetGroup>
<Template src="skin:padfx-settings.xml" trigger="[SettingsTab],padfx"/>
</Children></WidgetStack></Children></skin>)");
    file.close();
    auto config = UserSettingsPointer(new UserSettings(dir.filePath("settings.cfg"), root + "/res/", dir.path()));
    ControlDoublePrivate::setUserConfig(config);
    PadFxSettings settings(config);
    ControlObject touchShift(ConfigKey("[Controls]", "touch_shift"));
    // The real parser requires its keyboard/learning-filter services even for
    // labels. Never call setUpDevices: this fixture must not open a controller.
    ControllerManager controllers(config);
    ConfigObject<ConfigValueKbd> keyboardConfig(dir.filePath("keyboard.cfg"), root + "/res/", dir.path());
    KeyboardEventFilter keyboard(&keyboardConfig);
    QSet<ControlObject*> skinControls;
    LegacySkinParser parser(config, &skinControls, &keyboard, nullptr, &controllers,
            nullptr, nullptr, nullptr, nullptr);
    std::unique_ptr<QWidget> widget(parser.parseSkin(dir.path(), nullptr));
    require(widget != nullptr, "skin parsed");
    widget->resize(1024, 460); widget->show();
    ControlObject::set(ConfigKey("[SettingsTab]", "padfx"), 1);
    QTest::qWait(50);
    require(ControlObject::get(ConfigKey("[PadTest]", "current")) == 1, "Pad FX tab trigger");
    auto* scroll = widget->findChild<QScrollArea*>();
    require(scroll && scroll->widgetResizable(), "scrollable panel");
    auto* deck = widget->findChild<QComboBox*>("PadFxDeck");
    auto* bank = widget->findChild<QComboBox*>("PadFxBank");
    require(deck && bank, "deck and bank selectors");
    require(widget->findChildren<QComboBox*>().size() == 34, "eight pads, four fields each, two selectors");
    auto field = [&](int pad, int f) {
        auto* box = widget->findChild<QComboBox*>(QString("PadFxPad%1Field%2").arg(pad).arg(f));
        require(box && box->height() >= 50, "large touch target");
        return box;
    };
    auto read = [&](const QString& item) { return ControlObject::get(ConfigKey("[PadFX]", item)); };
    auto choose = [&](QComboBox* box, int value) {
        scroll->ensureWidgetVisible(box);
        box->setFocus();
        box->showPopup();
        QTest::keyClick(box, Qt::Key_Home);
        for (int n = 0; n < value; ++n) QTest::keyClick(box, Qt::Key_Down);
        QTest::keyClick(box, Qt::Key_Return);
        QCoreApplication::processEvents();
    };
    for (int p = 1; p <= 8; ++p) {
        require(field(p, 0)->count() == 17, "all assignment choices");
        require(field(p, 0)->currentIndex() == p - 1, "eight default normal assignments");
    }
    int stops = 0;
    QObject::connect(ControlObject::getControl(ConfigKey("[PadFX]", "clear_all")),
            &ControlObject::valueChanged, &app, [&](double value) { if (value == 1) ++stops; });
    choose(field(1, 0), 7);
    require(read("d1_s0_effect") == 7, "actual dropdown assigns effect");
    require(field(1, 1)->isEnabled() && field(1, 3)->isEnabled(), "release echo options enabled");
    choose(field(1, 1), 4); choose(field(1, 2), 2); choose(field(1, 3), 1);
    require(read("d1_s0_beat") == 4 && read("d1_s0_strength") == 2 && read("d1_s0_hold") == 1, "pad fields persist");
    for (int d = 0; d < 4; ++d) {
        deck->setCurrentIndex(d);
        for (int b = 0; b < 2; ++b) {
            bank->setCurrentIndex(b);
            for (int p = 1; p <= 8; ++p) {
                choose(field(p, 0), 16);
                require(read(QString("d%1_s%2_effect").arg(d + 1).arg(b * 8 + p - 1)) == 16, "all 64 slots individually mapped");
                auto* reset = widget->findChild<QPushButton*>(QString("PadFxReset%1").arg(p));
                scroll->ensureWidgetVisible(reset);
                QTest::mouseClick(reset, Qt::LeftButton);
                QCoreApplication::processEvents();
                require(read(QString("d%1_s%2_effect").arg(d + 1).arg(b * 8 + p - 1)) == b * 8 + p - 1, "reset targets visible pad and bank");
            }
        }
    }
    deck->setCurrentIndex(0); bank->setCurrentIndex(0);
    ControlObject::set(ConfigKey("[PadFX]", "d1_s0_effect"), 6);
    QCoreApplication::processEvents();
    require(field(1, 0)->currentIndex() == 6 && !field(1, 1)->isEnabled() && !field(1, 3)->isEnabled(), "external update reflected without feedback");
    require(read("d4_s15_effect") == 15, "bank refresh never overwrites another deck");
    auto* stop = widget->findChild<QPushButton*>("PadFxStop");
    scroll->ensureWidgetVisible(stop); QTest::mouseClick(stop, Qt::LeftButton);
    QTest::mouseClick(stop, Qt::LeftButton); QCoreApplication::processEvents();
    require(stops == 2 && read("clear_all") == 0, "repeatable emergency stop");
    widget->resize(480, 280); QTest::qWait(30);
    require(widget->width() == 480 && widget->height() == 280, "scroll area contains minimum size");
    scroll->ensureWidgetVisible(field(8, 0));
    if (argc >= 3) {
        widget->resize(1920, 1000); QTest::qWait(50);
        scroll->ensureWidgetVisible(deck); QTest::qWait(50);
        require(widget->grab().save(QString::fromLocal8Bit(argv[2])), "save UI evidence");
    }
    std::cout << "Pad FX grid PASS: real dropdowns, 64 slots, 4 decks, bank isolation, reset, options, persistence bridge and small-screen scrolling\\n";
    widget.reset();
    qDeleteAll(skinControls);
}
