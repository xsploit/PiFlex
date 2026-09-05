#pragma once

#include "track/track.h"
#include "waveform/renderers/phrasestrip.h"
#include "widget/wwidget.h"

// A separate skin row, not part of the deliberately clipped waveform widget.
// Read-only: phrase display never changes cues, audio, or exported analysis.
class WPhraseOverview final : public WWidget {
  public:
    explicit WPhraseOverview(double scale, QWidget* parent = nullptr)
            : WWidget(parent), m_scale(scale) {
        setFocusPolicy(Qt::NoFocus);
    }

    void setTrack(TrackPointer track) {
        QObject::disconnect(m_phraseConnection);
        m_track = std::move(track);
        if (m_track) {
            m_phraseConnection = connect(m_track.get(), &Track::phrasesUpdated,
                    this, [this] { update(); });
        }
        update();
    }

  protected:
    void paintEvent(QPaintEvent*) override {
        QPainter painter(this);
        painter.fillRect(rect(), Qt::black);
        if (!m_track) return;
        mixxx::paintPhraseStrip(painter, m_track->getPhrases(),
                rect().adjusted(1, int(2 * m_scale), -1, 0), Qt::Horizontal,
                0, m_track->getDuration(), m_scale, true);
    }

  private:
    TrackPointer m_track;
    QMetaObject::Connection m_phraseConnection;
    double m_scale;
};
