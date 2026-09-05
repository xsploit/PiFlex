#pragma once

#include <algorithm>
#include <cmath>

namespace mixxx {
// UI-only marquee: pause at each end, then restart. Elapsed time, rather than
// timer tick counts, keeps the speed stable when the UI misses a paint.
inline double textScrollOffset(double elapsedMs, double overflow, double pixelsPerSecond) {
    if (overflow <= 0 || pixelsPerSecond <= 0 || elapsedMs <= 0) {
        return 0;
    }
    constexpr double pauseMs = 1500;
    const double travelMs = overflow * 1000 / pixelsPerSecond;
    const double phase = std::fmod(elapsedMs, travelMs + 2 * pauseMs);
    return std::clamp((phase - pauseMs) * pixelsPerSecond / 1000, 0.0, overflow);
}
} // namespace mixxx
