#pragma once

#include <QString>
#include <QStringList>

#include "audio/types.h"
#include "track/track_decl.h"

namespace mixxx {
namespace rekordbox {

/// Import beats and/or cues from a rekordbox ANLZ file onto a track.
///
/// `ignoreCues` picks which half of the file is read: beats when true, cues
/// when false. The grid comes from `.DAT`; cues come from `.EXT` if present,
/// otherwise `.DAT` is read a second time for cues. Throws on read/parse errors.
///
/// The cue pass treats the ANLZ file as the authority for the whole track:
/// hot cues land in the hot cue bank, memory cues in the memory cue bank (see
/// `kHotCueBankStart` / `kMemoryCueBankStart` in `track/cueinfo.h`), and any
/// hotcue slot the file does not describe is cleared. Cues that survive are
/// updated in place, because this runs on every load of a track that a deck
/// may already be playing.
///
/// Declared here rather than kept file-local so that it can be tested
/// directly; the definition lives in rekordboxfeature.cpp.
void readAnalyze(TrackPointer track,
        audio::SampleRate sampleRate,
        int timingOffset,
        bool ignoreCues,
        const QString& anlzPath);

/// Import the two passes without letting missing/corrupt analysis prevent
/// loading audio. Returns failed file paths for a user-facing warning.
QStringList readAnalyzeFiles(TrackPointer track,
        audio::SampleRate sampleRate,
        int timingOffset,
        const QString& anlzPath);

} // namespace rekordbox
} // namespace mixxx
