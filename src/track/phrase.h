#pragma once

#include <QList>
#include <QString>

namespace mixxx {

// Source analysis is independent of cue slots. Track retains an immutable
// imported copy and projects the displayed copy when its beatgrid is edited.
// Seconds are in the decoded audio timebase, after the importer timing offset.
struct Phrase {
    enum class Kind { Unknown, Intro, Verse, Bridge, Chorus, Up, Down, Outro };
    double startSeconds = 0;
    double endSeconds = 0;
    double fillSeconds = -1;
    Kind kind = Kind::Unknown;
    QString label;
    bool operator==(const Phrase&) const = default;
};
using PhraseList = QList<Phrase>;

} // namespace mixxx
