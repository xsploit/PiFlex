#pragma once

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <vector>

#include <rekordbox_anlz.h>
#include "track/phrase.h"
#include "util/fpclassify.h"

namespace mixxx::rekordbox {

inline Phrase phraseKind(const rekordbox_anlz_t::song_structure_entry_t& entry, int mood) {
    Phrase phrase;
    int id = 0;
    if (mood == 1) {
        id = static_cast<rekordbox_anlz_t::phrase_high_t*>(entry.kind())->id();
        switch (id) {
        case 1: phrase.kind = Phrase::Kind::Intro; phrase.label = "Intro"; break;
        case 2: phrase.kind = Phrase::Kind::Up; phrase.label = "Up"; break;
        case 3: phrase.kind = Phrase::Kind::Down; phrase.label = "Down"; break;
        case 5: phrase.kind = Phrase::Kind::Chorus; phrase.label = "Chorus"; break;
        case 6: phrase.kind = Phrase::Kind::Outro; phrase.label = "Outro"; break;
        }
    } else if (mood == 2 || mood == 3) {
        id = mood == 2 ? int(static_cast<rekordbox_anlz_t::phrase_mid_t*>(entry.kind())->id())
                       : int(static_cast<rekordbox_anlz_t::phrase_low_t*>(entry.kind())->id());
        if (id == 1) { phrase.kind = Phrase::Kind::Intro; phrase.label = "Intro"; }
        else if (id >= 2 && id <= 7) {
            phrase.kind = Phrase::Kind::Verse;
            phrase.label = QStringLiteral("Verse %1").arg(mood == 2 ? id - 1 : (id <= 4 ? 1 : 2));
        } else if (id == 8) { phrase.kind = Phrase::Kind::Bridge; phrase.label = "Bridge"; }
        else if (id == 9) { phrase.kind = Phrase::Kind::Chorus; phrase.label = "Chorus"; }
        else if (id == 10) { phrase.kind = Phrase::Kind::Outro; phrase.label = "Outro"; }
    }
    if (phrase.label.isEmpty()) {
        phrase.label = QStringLiteral("Phrase"); // Unknown kinds are not guessed.
    }
    return phrase;
}

inline PhraseList decodePhrases(const rekordbox_anlz_t::song_structure_tag_t& tag,
        const std::vector<double>& beatMillis, double durationSeconds, int timingOffsetMillis,
        double finalBoundaryMillis = std::numeric_limits<double>::quiet_NaN(),
        int* ignoredFills = nullptr) {
    if (ignoredFills) *ignoredFills = 0;
    if (!util_isfinite(durationSeconds) || durationSeconds <= 0 || beatMillis.empty()) {
        throw std::runtime_error("Phrase timing requires the exported beatgrid and audio duration");
    }
    for (size_t i = 0; i < beatMillis.size(); ++i) {
        if (!util_isfinite(beatMillis[i]) || beatMillis[i] < 0 ||
                (i && beatMillis[i] <= beatMillis[i - 1])) {
            throw std::runtime_error("Invalid exported phrase beat timing");
        }
    }
    const auto* body = tag.body();
    const auto& entries = *body->entries();
    if (tag.len_entry_bytes() != 24 || entries.size() > 65535) {
        throw std::runtime_error("Unsupported phrase entry layout");
    }
    const auto timeAt = [&](unsigned beat, bool ending = false) {
        // PSSI uses absolute one-based beat indices, not PQTZ's 1..4 bar beat.
        // Some exports end at N+1. Only that endpoint may use the last beat's
        // exported tempo; never extrapolate arbitrary missing phrase starts.
        if (ending && beat == beatMillis.size() + 1 &&
                util_isfinite(finalBoundaryMillis) && finalBoundaryMillis > beatMillis.back()) {
            return std::clamp((finalBoundaryMillis - timingOffsetMillis) / 1000.0,
                    0.0, durationSeconds);
        }
        if (!beat || beat > beatMillis.size()) {
            throw std::runtime_error("Phrase beat " + std::to_string(beat) +
                    " exceeds exported grid size " + std::to_string(beatMillis.size()));
        }
        return std::clamp((beatMillis[beat - 1] - timingOffsetMillis) / 1000.0,
                0.0, durationSeconds);
    };
    PhraseList result;
    for (size_t i = 0; i < entries.size(); ++i) {
        const auto& entry = *entries[i];
        const unsigned end = i + 1 < entries.size() ? entries[i + 1]->beat() : body->end_beat();
        if (end <= entry.beat()) {
            throw std::runtime_error("Unordered or empty exported phrase");
        }
        auto phrase = phraseKind(entry, int(body->mood()));
        phrase.startSeconds = timeAt(entry.beat());
        phrase.endSeconds = timeAt(end, i + 1 == entries.size());
        if (entry.fill()) {
            if (entry.beat_fill() < entry.beat() || entry.beat_fill() >= end) {
                // A bad optional fill must not discard valid phrase boundaries.
                if (ignoredFills) ++*ignoredFills;
            } else {
                phrase.fillSeconds = timeAt(entry.beat_fill());
            }
        }
        if (phrase.endSeconds > phrase.startSeconds) result.append(phrase);
    }
    return result;
}

} // namespace mixxx::rekordbox
