// Real control -> EffectSlot -> engine audio regression; no controller/DSP mocks.
#include <QCoreApplication>
#include <QTemporaryDir>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>
#include "control/control.h"
#include "control/controlobject.h"
#include "effects/effectsmanager.h"
#include "engine/effects/engineeffectsmanager.h"
#include "engine/effects/groupfeaturestate.h"

int main(int argc, char** argv) {
    QCoreApplication app(argc, argv);
    QTemporaryDir dir;
    auto config = UserSettingsPointer(new UserSettings(dir.filePath("test.cfg"), dir.path(), dir.path()));
    ControlDoublePrivate::setUserConfig(config);
    auto factory = std::make_shared<ChannelHandleFactory>();
    EffectsManager manager(config, factory);
    ChannelHandleAndGroup output(factory->getOrCreateHandle("[Master]"), "[Master]");
    ChannelHandleAndGroup deck(factory->getOrCreateHandle("[Channel1]"), "[Channel1]");
    manager.registerOutputChannel(output);
    manager.registerInputChannel(deck);
    manager.addDeck(deck);
    auto* engine = manager.getEngineEffectsManager();
    const QString group = "[PadEffectRack1_[Channel1]_sweep]";
    auto set = [&](const char* key, double value) {
        ControlObject::set(ConfigKey(group, key), value);
        QCoreApplication::processEvents();
        engine->onCallbackStart();
    };
    if (ControlObject::get(ConfigKey(group, "available")) != 1) {
        throw std::runtime_error("native filter lane unavailable");
    }
    engine->onCallbackStart();
    set("prepare", 1);
    set("param_hpf", 13);
    set("param_lpf", 500);
    set("param_q", 0.9);
    GroupFeatureState features;
    features.beat_length = GroupFeatureBeatLength{.5, 1};
    constexpr int frames = 256;
    std::vector<CSAMPLE> buffer(frames * 2);
    long long frame = 0;
    auto measure = [&]() {
        double energy = 0;
        for (int block = 0; block < 50; ++block) {
            for (int i = 0; i < frames; ++i, ++frame) {
                buffer[2*i] = buffer[2*i+1] = static_cast<CSAMPLE>(.25 * std::sin(2 * 3.141592653589793 * 8000 * frame / 48000));
            }
            engine->onCallbackStart();
            engine->processPostFaderInPlace(deck.handle(), output.handle(), buffer.data(),
                    buffer.size(), mixxx::audio::SampleRate(48000), features, 1, 1, false);
            if (block > 10) for (float sample : buffer) energy += sample * sample;
        }
        return energy;
    };
    const double bypass = measure();
    set("active", 1);
    const double enabled = measure();
    set("active", 0);
    const double released = measure();
    std::cout << "Control-to-audio: bypass=" << bypass << " enabled=" << enabled
              << " released=" << released << std::endl;
    if (!(enabled < bypass * .05)) throw std::runtime_error("Pad FX enabled control did not reach audio DSP");
    if (!(released > bypass * .99 && released < bypass * 1.01)) {
        throw std::runtime_error("Pad FX release did not restore bypass");
    }
    std::cout << "Pad FX control-to-audio routing PASS" << std::endl;
}
