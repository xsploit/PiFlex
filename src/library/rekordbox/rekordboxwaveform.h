#pragma once

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

#include "waveform/waveform.h"
#include "util/fpclassify.h"

namespace mixxx::rekordbox {

// PWV6/PWV7 contain mono display heights in mid/high/low order, not PCM or
// stereo RMS. Preserve their relative heights and mirror the mono display into
// the renderer's two channels. Do not reinterpret Pioneer RGB bytes as bands.
inline std::vector<WaveformData> decodeThreeBandWaveform(const std::string& bytes,
        double sourceRate,
        double destinationRate,
        int destinationColumns,
        int timingOffsetMillis,
        bool normalizeDisplay = false) {
    if (bytes.empty() || bytes.size() % 3 != 0 ||
            bytes.size() / 3 > 4320000 || destinationColumns <= 0 ||
            destinationColumns > 4320002 ||
            !util_isfinite(sourceRate) || sourceRate <= 0 ||
            !util_isfinite(destinationRate) || destinationRate <= 0) {
        throw std::runtime_error("Invalid Rekordbox three-band waveform dimensions");
    }
    // Both PWV6 and PWV7 are prepared display envelopes, not native RMS.
    // Fit each complete envelope's shared band peak to the native renderers'
    // 8-bit display range. One fixed multiplier for the entire track preserves
    // relative band heights and dynamics, with no per-window gain pumping.
    // Existing skin/mode/visual gain controls still apply downstream. This is
    // display normalization, not PCM normalization or Pioneer's transfer curve.
    unsigned int peak = 0;
    if (normalizeDisplay) {
        for (unsigned char value : bytes) {
            peak = std::max(peak, static_cast<unsigned int>(value));
        }
    }
    const auto displayHeight = [&](char byte) -> unsigned char {
        const unsigned int value = static_cast<unsigned char>(byte);
        return normalizeDisplay && peak ? (value * 255u + peak / 2u) / peak : value;
    };
    std::vector<WaveformData> result(size_t(destinationColumns) * 2, WaveformData(0));
    for (int i = 0; i < destinationColumns; ++i) {
        const double sourceIndex = std::floor(
                i * (sourceRate / destinationRate) + timingOffsetMillis * (sourceRate / 1000.0));
        // Keep the 150 Hz detail timebase. Do not stretch it to rounded PDB
        // duration, or repeat the last column into audio beyond the export.
        if (sourceIndex < 0 || sourceIndex >= double(bytes.size() / 3)) {
            continue;
        }
        const size_t offset = size_t(sourceIndex) * 3;
        WaveformData value(0);
        value.filtered.mid = displayHeight(bytes[offset]);
        value.filtered.high = displayHeight(bytes[offset + 1]);
        value.filtered.low = displayHeight(bytes[offset + 2]);
        value.filtered.all = std::max({value.filtered.low, value.filtered.mid, value.filtered.high});
        result[size_t(i) * 2] = value;
        result[size_t(i) * 2 + 1] = value;
    }
    return result;
}

} // namespace mixxx::rekordbox
