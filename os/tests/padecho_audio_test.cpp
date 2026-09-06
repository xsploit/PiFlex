// Offline checks of actual native DSP, not a controller API mock.
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

#include "effects/backends/builtin/echoeffect.h"
#include "effects/backends/effectmanifest.h"
#include "engine/effects/engineeffectparameter.h"
#include "util/fpclassify.h"

void require(bool ok, const char* message) {
    if (!ok) { throw std::runtime_error(message); }
}

int main() {
    for (int sampleRate : {44100, 48000}) {
        for (int frames : {32, 256, 1024}) {
            mixxx::EngineParameters engine(mixxx::audio::SampleRate(sampleRate), frames);
            PadEchoEffect fx;
            EchoGroupState state(engine);
            QMap<QString, EngineEffectParameterPointer> p;
            const auto effectManifest = PadEchoEffect::getManifest();
            for (const auto& manifest : effectManifest->parameters()) {
                p.insert(manifest->id(), EngineEffectParameterPointer(new EngineEffectParameter(manifest)));
            }
            fx.loadEngineEffectParameters(p);
            p["delay_time"]->setValue(.5);
            p["quantize"]->setValue(0);
            p["send_amount"]->setValue(.22);
            p["feedback_amount"]->setValue(.38);
            GroupFeatureState features;
            features.beat_length = GroupFeatureBeatLength{.5, 1};
            const auto count = engine.samplesPerBuffer();
            std::vector<CSAMPLE> in(count, 0), out(count + 2, 12345);
            const auto process = [&](EffectEnableState enabled = EffectEnableState::Enabled) {
                fx.processChannel(&state, in.data(), out.data() + 1, engine, enabled, features);
                require(out.front() == 12345 && out.back() == 12345, "output guard overwritten");
                for (int i=1; i<=count; ++i) { require(util_isfinite(double(out[i])), "nonfinite output"); }
            };
            process(EffectEnableState::Enabling); // settle input ramp
            in[0] = in[1] = 1;
            process();
            std::fill(in.begin(), in.end(), 0);
            p["send_amount"]->setValue(0); // pad release: keep processing buffer
            double earlyEnergy = 0, latePeak = 0;
            for (int i=0; i<sampleRate*5/frames; ++i) {
                process();
                for (int s=1; s<=count; ++s) {
                    if (i*frames < sampleRate) { earlyEnergy += out[s]*out[s]; }
                    if (i*frames > sampleRate*4) { latePeak = std::max(latePeak, std::abs(double(out[s]))); }
                }
            }
            require(earlyEnergy > .01, "echo lost on send release");
            require(latePeak < 1e-6, "echo did not decay");
            // Dry path goes silent after its ramp without altering the input.
            state.clear();
            p["dry_amount"]->setValue(0);
            std::fill(in.begin(), in.end(), .25);
            process(); process();
            for (int s=1; s<=count; ++s) { require(std::abs(out[s]) < 1e-7, "release dry gate leaks"); }
            p["dry_amount"]->setValue(1);
            process(); process();
            for (int s=1; s<=count; ++s) { require(std::abs(out[s]-.25) < 1e-7, "dry restore changes gain"); }
            p["dry_amount"]->setValue(0);
            process(); process(); process(EffectEnableState::Disabling);
            require(std::abs(out[count]-.25) < .01, "disable fails to ramp back to dry");
            std::cout << sampleRate << " Hz / " << frames << " frames: tail=" << earlyEnergy
                      << ", late peak=" << latePeak << " PASS\n";
        }
    }
}
