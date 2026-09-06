// Parse the actual Pad FX skin using the native parser and click its controls.
// A temporary wrapper omits unrelated players/audio so this never opens a DJ session.
#include <QApplication>
#include <QFile>
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
#include "widget/wpushbutton.h"

void require(bool value, const char* message) {
    if (!value) { throw std::runtime_error(message); }
}
int main(int argc, char** argv) {
    QApplication app(argc, argv);
    require(argc >= 2, "expected repository path");
    const QString root = QString::fromLocal8Bit(argv[1]);
    QTemporaryDir dir;
    require(dir.isValid(), "temporary skin");
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
    const auto buttons = widget->findChildren<WPushButton*>();
    require(buttons.size() == 8, "all editor controls parsed");
    int stops = 0;
    QObject::connect(ControlObject::getControl(ConfigKey("[PadFX]", "clear_all")),
            &ControlObject::valueChanged, &app, [&](double value) { if (value == 1) { ++stops; } });
    auto* scroll = widget->findChild<QScrollArea*>();
    require(scroll && scroll->widgetResizable(), "scrollable small-screen panel");
    for (auto* button : buttons) {
        require(button->height() >= 40 && button->width() >= 80, "touch target size");
    }
    // CSS minimum widths can override a Fixed width on WPushButton itself.
    // Keep explicit value containers and reject the formerly clipped 80px fields.
    require(buttons[0]->width() >= 150 && buttons[1]->width() >= 280, "selector widths");
    for (int i = 2; i <= 5; ++i) {
        require(buttons[i]->width() >= 430, "value label width");
    }
    auto click = [&](int index) {
        scroll->ensureWidgetVisible(buttons[index]);
        QTest::mouseClick(buttons[index], Qt::LeftButton);
        QCoreApplication::processEvents();
    };
    click(0); require(ControlObject::get(ConfigKey("[PadFX]", "deck")) == 1, "deck button");
    click(1); require(ControlObject::get(ConfigKey("[PadFX]", "slot")) == 1, "slot button");
    click(2); require(ControlObject::get(ConfigKey("[PadFX]", "d2_s1_effect")) == 2, "effect button persists");
    click(3); require(ControlObject::get(ConfigKey("[PadFX]", "beat")) == 1, "beat button");
    click(4); require(ControlObject::get(ConfigKey("[PadFX]", "strength")) == 0, "strength button wraps");
    click(5); require(ControlObject::get(ConfigKey("[PadFX]", "hold")) == 1, "hold button");
    click(6); require(ControlObject::get(ConfigKey("[PadFX]", "effect")) == 1, "reset button");
    click(7); require(ControlObject::get(ConfigKey("[PadFX]", "clear_all")) == 0, "panic releases after click");
    widget->resize(480, 280); QTest::qWait(50);
    require(widget->width() == 480 && widget->height() == 280, "panel does not inflate application minimum size");
    click(6); click(7); // still reachable via scrolling at small dimensions
    require(stops == 2, "panic can be used repeatedly");
    if (argc >= 3) {
        widget->resize(1024, 560); QTest::qWait(50);
        scroll->ensureWidgetVisible(buttons[0]); QTest::qWait(50);
        require(widget->grab().save(QString::fromLocal8Bit(argv[2])), "save UI evidence");
    }
    std::cout << "Pad FX native UI PASS: real skin parser, tab trigger, eight clickable controls, persistence, scroll access, small-window sizing\n";
    widget.reset();
    qDeleteAll(skinControls);
}
