// Standalone integration test: real ConfigObject + real ControlObjects, no mock.
#include <QCoreApplication>
#include <QTemporaryDir>
#include <iostream>
#include <limits>
#include <stdexcept>

#include "control/control.h"
#include "control/controlobject.h"
#include "preferences/padfxsettings.h"

namespace {
void require(bool value, const char* message) {
    if (!value) { throw std::runtime_error(message); }
}
double get(const char* item) {
    return ControlObject::get(ConfigKey("[PadFX]", item));
}
void set(const char* item, double value) {
    ControlObject::set(ConfigKey("[PadFX]", item), value);
    QCoreApplication::processEvents();
}
} // namespace

int main(int argc, char** argv) {
    QCoreApplication app(argc, argv);
    QTemporaryDir dir;
    require(dir.isValid(), "temporary settings directory");
    const auto path = dir.filePath("padfx.cfg");
    auto config = UserSettingsPointer(new UserSettings(path, dir.path(), dir.path()));
    config->setValue(ConfigKey("[PadFX_v1]", "d1_s4_effect"), 999);
    config->setValue(ConfigKey("[PadFX_v2]", "future_value"), 123);
    ControlDoublePrivate::setUserConfig(config);
    {
        PadFxSettings settings(config);
        require(get("version") == 1, "control contract");
        require(get("d1_s4_effect") == 4, "invalid saved assignment fallback");
        require(get("d4_s15_effect") == 15, "four deck defaults");
        set("slot", 4);
        require(get("effect") == 4 && get("strength") == 4, "selection refresh");
        set("effect", 7); set("beat", 6); set("strength", 2); set("hold", 1);
        require(get("d1_s4_effect") == 7, "editor assignment write");
        require(config->getValue<int>(ConfigKey("[PadFX_v1]", "d1_s4_effect"), -1) == 7, "editor persisted");
        set("deck", 1);
        require(get("effect") == 4 && get("strength") == 4, "deck isolation");
        set("d1_s4_strength", 1); set("deck", 0);
        require(get("strength") == 1, "direct control update reflected in editor");
        for (double bad : {-1.0, 900.0, 0.5, std::numeric_limits<double>::quiet_NaN(),
                     std::numeric_limits<double>::infinity()}) {
            set("effect", bad); require(get("effect") == 7, "invalid editor rejected");
            set("d1_s4_effect", bad); require(get("d1_s4_effect") == 7, "invalid direct write rejected");
            set("slot", bad); require(get("slot") == 0, "invalid slot guarded");
            set("deck", bad); require(get("deck") == 0, "invalid deck guarded");
            set("slot", 4);
        }
        require(config->save(), "settings saved to disk");
    }
    config = UserSettingsPointer(new UserSettings(path, dir.path(), dir.path()));
    ControlDoublePrivate::setUserConfig(config);
    {
        PadFxSettings settings(config);
        set("slot", 4);
        require(get("effect") == 7 && get("beat") == 6 && get("strength") == 1 && get("hold") == 1,
                "disk round trip");
        set("reset_slot", 1); set("reset_slot", 0);
        require(get("effect") == 4 && get("beat") == 0 && get("strength") == 4 && get("hold") == 0,
                "selected reset");
        set("effect", 9); set("reset_slot", 1); set("reset_slot", 0);
        require(get("effect") == 4, "reset is reusable");
        require(config->getValue<int>(ConfigKey("[PadFX_v2]", "future_value"), -1) == 123,
                "unknown future namespace preserved");
    }
    std::cout << "Pad FX native settings PASS: real CO/editor synchronization, validation, four decks, disk roundtrip, repeatable reset, future namespace preservation\n";
}
