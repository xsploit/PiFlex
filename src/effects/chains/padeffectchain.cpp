#include "effects/chains/padeffectchain.h"

#include <algorithm>
#include <cmath>

#include "effects/effectsmanager.h"
#include "effects/effectslot.h"
#include "util/fpclassify.h"

PadEffectChain::PadEffectChain(const ChannelHandleAndGroup& deck,
        const QString& lane,
        const QString& effectId,
        EffectsManager* manager,
        EffectsMessengerPointer messenger)
        : PerGroupEffectChain(deck,
                  QString("[PadEffectRack1_%1_%2]").arg(deck.name(), lane),
                  // Prefader processing receives an empty GroupFeatureState:
                  // tempo-aware Pad FX must run in the postfader stage.
                  SignalProcessingStage::Postfader,
                  manager,
                  messenger),
          m_manifest(manager->getBackendManager()->getManifest(
                  effectId, EffectBackendType::BuiltIn)) {
    addEffectSlot(QString("[PadEffectRack1_%1_%2_Effect1]").arg(deck.name(), lane));
    enableForInputChannel(deck);
    m_effectSlots[0]->setEnabled(false);
    const auto addControl = [this](const QString& key, double value) {
        auto control = std::make_shared<ControlObject>(ConfigKey(group(), key));
        control->set(value);
        m_controls.insert(key, control);
        return control;
    };
    addControl("available", m_manifest ? 1 : 0)->setReadOnly();
    if (m_manifest) {
        for (const auto& parameter : m_manifest->parameters()) {
            const QString id = parameter->id();
            auto control = addControl("param_" + id, parameter->getDefault());
            connect(control.get(), &ControlObject::valueChanged, this,
                    [this, parameter, id, control = control.get()](double value) {
                        if (!util_isfinite(value)) {
                            value = parameter->getDefault();
                        }
                        value = std::clamp(value, parameter->getMinimum(), parameter->getMaximum());
                        if (control->get() != value) {
                            control->set(value);
                        }
                        if (m_parameters.contains(id)) {
                            m_parameters.value(id)->setValue(value);
                        }
                    });
        }
    }
    auto warm = addControl("prepare", 0);
    connect(warm.get(), &ControlObject::valueChanged, this, [this](double value) {
        if (value > 0) {
            prepare();
        }
    });
    auto active = addControl("active", 0);
    connect(active.get(), &ControlObject::valueChanged, this, [this](double value) {
        if (value > 0) {
            prepare();
        }
        m_effectSlots[0]->setEnabled(value > 0 && !m_parameters.isEmpty());
    });
}

void PadEffectChain::prepare() {
    if (!m_manifest || !m_parameters.isEmpty()) {
        return;
    }
    const auto slot = m_effectSlots[0];
    slot->loadEffectWithDefaults(m_manifest);
    // Reset even parameters hidden/reordered by a user's saved effect preset.
    // Never link these private values to the rack's superknob.
    for (const auto& map : {slot->getLoadedParameters(), slot->getHiddenParameters()}) {
        for (const auto& list : map) {
            for (const auto& parameter : list) {
                const auto id = parameter->manifest()->id();
                parameter->setLinkType(EffectManifestParameter::LinkType::None);
                parameter->setValue(m_controls.value("param_" + id)->get());
                m_parameters.insert(id, parameter);
            }
        }
    }
}
