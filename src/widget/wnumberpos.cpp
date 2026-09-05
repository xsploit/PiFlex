#include "widget/wnumberpos.h"

#include "control/controlproxy.h"
#include <QMouseEvent>
#include "skin/legacy/skincontext.h"
#include "moc_wnumberpos.cpp"
#include "util/duration.h"

WNumberPos::WNumberPos(const QString& group, QWidget* parent)
        : WNumber(parent),
          m_displayFormat(TrackTime::DisplayFormat::TRADITIONAL),
          m_dOldTimeElapsed(0.0) {
    m_pTimeElapsed = new ControlProxy(group, "time_elapsed", this, ControlFlag::NoAssertIfMissing);
    m_pTimeElapsed->connectValueChanged(this, &WNumberPos::slotSetTimeElapsed);
    m_pTimeRemaining = new ControlProxy(
            group, "time_remaining", this, ControlFlag::NoAssertIfMissing);
    m_pTimeRemaining->connectValueChanged(
            this, &WNumberPos::slotTimeRemainingUpdated);

    m_pShowTrackTimeRemaining = new ControlProxy(
            "[Controls]", "ShowDurationRemaining", this);
    m_pShowTrackTimeRemaining->connectValueChanged(
            this, &WNumberPos::slotSetDisplayMode);
    slotSetDisplayMode(m_pShowTrackTimeRemaining->get());

    m_pTimeFormat = new ControlProxy(
            "[Controls]", "TimeFormat", this);
    m_pTimeFormat->connectValueChanged(
            this, &WNumberPos::slotSetTimeFormat);
    slotSetTimeFormat(m_pTimeFormat->get());
}

void WNumberPos::setup(const QDomNode& node, const SkinContext& context) {
    WNumber::setup(node, context);
    const QString modeKey = context.selectString(node, "ModeConfigKey");
    const int comma = modeKey.indexOf(QLatin1Char(','));
    if (comma <= 0 || comma == modeKey.size() - 1) {
        return; // Other skins retain the existing global display preference.
    }
    auto* control = new ControlProxy(modeKey.left(comma).trimmed(),
            modeKey.mid(comma + 1).trimmed(), this, ControlFlag::NoAssertIfMissing);
    if (!control->valid()) {
        delete control;
        return;
    }
    delete m_pShowTrackTimeRemaining;
    m_pShowTrackTimeRemaining = control;
    m_perDeckMode = true;
    control->connectValueChanged(this, &WNumberPos::slotSetDisplayMode);
    slotSetDisplayMode(control->get());
    setCursor(Qt::PointingHandCursor);
}

void WNumberPos::mousePressEvent(QMouseEvent* event) {
    if (m_perDeckMode && event->button() == Qt::LeftButton) {
        m_pShowTrackTimeRemaining->set(
                m_displayMode == TrackTime::DisplayMode::REMAINING ? 0.0 : 1.0);
        event->accept();
        return;
    }
    WNumber::mousePressEvent(event);
}

// Reimplementing WNumber::setValue
void WNumberPos::setValue(double dValue) {
    // Ignore midi-scaled signals from the skin connection.
    Q_UNUSED(dValue);
    // Update our value with the old value.
    slotSetTimeElapsed(m_dOldTimeElapsed);
}

void WNumberPos::slotSetTimeElapsed(double dTimeElapsed) {
    double dTimeRemaining = m_pTimeRemaining->get();
    QString (*timeFormat)(double dSeconds, mixxx::Duration::Precision precision);

    if (m_displayFormat == TrackTime::DisplayFormat::KILO_SECONDS) {
        timeFormat = &mixxx::Duration::formatKiloSeconds;
    } else if (m_displayFormat == TrackTime::DisplayFormat::SECONDS_LONG) {
        timeFormat = &mixxx::Duration::formatSecondsLong;
    } else if (m_displayFormat == TrackTime::DisplayFormat::SECONDS) {
       timeFormat = &mixxx::Duration::formatSeconds;
    } else {
        timeFormat = &mixxx::Duration::formatTime;
    }

    mixxx::Duration::Precision precision;
    if (m_displayFormat != TrackTime::DisplayFormat::TRADITIONAL_COARSE) {
        precision = mixxx::Duration::Precision::CENTISECONDS;
    } else {
        precision = mixxx::Duration::Precision::SECONDS;
    }

    if (m_displayMode == TrackTime::DisplayMode::ELAPSED) {
        if (dTimeElapsed >= 0.0) {
            setText(timeFormat(dTimeElapsed, precision));
        } else {
            setText(QLatin1String("-") % timeFormat(-dTimeElapsed, precision));
        }
    } else if (m_displayMode == TrackTime::DisplayMode::REMAINING) {
        setText(QLatin1String("-") % timeFormat(dTimeRemaining, precision));
    } else if (m_displayMode == TrackTime::DisplayMode::ELAPSED_AND_REMAINING) {
        if (dTimeElapsed >= 0.0) {
            setText(timeFormat(dTimeElapsed, precision)
                    % QLatin1String("  -") % timeFormat(dTimeRemaining, precision));
        } else {
            setText(QLatin1String("-") % timeFormat(-dTimeElapsed, precision)
                    % QLatin1String("  -") % timeFormat(dTimeRemaining, precision));
        }
    }
    m_dOldTimeElapsed = dTimeElapsed;
}

// m_pTimeElapsed is not updated when paused at the beginning of a track,
// but m_pTimeRemaining is updated in that case. So, call slotSetTimeElapsed to
// update this widget's text.
void WNumberPos::slotTimeRemainingUpdated(double dTimeRemaining) {
    Q_UNUSED(dTimeRemaining);
    double dTimeElapsed = m_pTimeElapsed->get();
    if (dTimeElapsed == 0.0) {
        slotSetTimeElapsed(dTimeElapsed);
    }
}

void WNumberPos::slotSetDisplayMode(double remain) {
    if (m_perDeckMode) {
        // This compact readout offers two modes, even if a saved/custom control
        // contains a legacy "both" value or another out-of-range number.
        remain = remain == 0.0 ? 0.0 : 1.0;
    }
    if (remain == 1.0) {
        m_displayMode = TrackTime::DisplayMode::REMAINING;
    } else if (remain == 2.0) {
        m_displayMode = TrackTime::DisplayMode::ELAPSED_AND_REMAINING;
    } else {
        m_displayMode = TrackTime::DisplayMode::ELAPSED;
    }

    slotSetTimeElapsed(m_dOldTimeElapsed);
}
void WNumberPos::slotSetTimeFormat(double v) {
    m_displayFormat = static_cast<TrackTime::DisplayFormat>(static_cast<int>(v));

    slotSetTimeElapsed(m_dOldTimeElapsed);
}
