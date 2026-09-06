#pragma once

#include <array>
#include <memory>
#include <vector>

#include <QObject>

#include "preferences/usersettings.h"

class ControlObject;

// Main-thread preferences bridge. The mapping snapshots a slot on note-on;
// neither config access nor UI work runs in the audio callback.
class PadFxSettings : public QObject {
  public:
    explicit PadFxSettings(UserSettingsPointer config);
    ~PadFxSettings() override;

  private:
    static constexpr int kFields = 4;
    ControlObject* addControl(const QString& item, int states, int initial);
    void refreshEditor();
    void setSlot(int slot, int field, double value);
    int selectedSlot() const;

    UserSettingsPointer m_config;
    std::vector<std::unique_ptr<ControlObject>> m_controls;
    std::array<std::array<ControlObject*, kFields>, 64> m_slots{};
    std::array<std::array<int, kFields>, 64> m_values{};
    std::array<ControlObject*, kFields> m_editor{};
    ControlObject* m_deck = nullptr;
    ControlObject* m_slot = nullptr;
    bool m_refreshing = false;
};
