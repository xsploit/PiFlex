#pragma once

#include "control/controlobject.h"
#include "effects/chains/pergroupeffectchain.h"
#include "effects/effectparameter.h"

// Private, per-deck Pad FX lane. Never shares user presets or the CFX/Beat FX
// racks. Controls use manifest IDs and real parameter units, not list indices.
class PadEffectChain final : public PerGroupEffectChain {
  public:
    PadEffectChain(const ChannelHandleAndGroup& deck,
            const QString& lane,
            const QString& effectId,
            EffectsManager* manager,
            EffectsMessengerPointer messenger);

  private:
    void prepare();
    EffectManifestPointer m_manifest;
    QHash<QString, std::shared_ptr<ControlObject>> m_controls;
    QHash<QString, EffectParameterPointer> m_parameters;
};
