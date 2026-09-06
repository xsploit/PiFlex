#include "widget/wlabel.h"

#include <QEvent>
#include <QFont>
#include <QPainter>

#include "moc_wlabel.cpp"
#include "skin/legacy/skincontext.h"
#include "widget/wskincolor.h"
#include "widget/textscroll.h"

WLabel::WLabel(QWidget* pParent)
        : QLabel(pParent),
          WBaseWidget(this),
          m_skinText(),
          m_longText(),
          m_elideMode(Qt::ElideNone),
          m_scaleFactor(1.0),
          m_highlight(0),
          m_widthHint(0) {
    m_scrollTimer.setInterval(40);
    connect(&m_scrollTimer, &QTimer::timeout, this, [this] { update(); });
}

void WLabel::setup(const QDomNode& node, const SkinContext& context) {
    m_scaleFactor = context.getScaleFactor();
    m_bTabularNumbers = context.selectBool(node, "TabularNumbers", false);

    // Colors
    QPalette pal = palette(); // we have to copy out the palette to edit it since it's const (probably for threadsafety)

    QDomElement bgColor = context.selectElement(node, "BgColor");
    if (!bgColor.isNull()) {
        m_qBgColor = QColor(context.nodeToString(bgColor));
        pal.setColor(this->backgroundRole(), WSkinColor::getCorrectColor(m_qBgColor));
        setAutoFillBackground(true);
    }

    m_qFgColor = QColor(context.selectString(node, "FgColor"));
    pal.setColor(this->foregroundRole(), WSkinColor::getCorrectColor(m_qFgColor));
    setPalette(pal);

    // Font size
    QString strFontSize;
    if (context.hasNodeSelectString(node, "FontSize", &strFontSize)) {
        bool widthOk = false;
        double dFontSize = strFontSize.toDouble(&widthOk);
        if (widthOk && dFontSize >= 0) {
            QFont fonti = font();
            // We do not scale the font here, because in most cases
            // this is overridden by the style sheet font size
            fonti.setPointSizeF(dFontSize);
            setFont(fonti);
        }
    }

    // Text
    if (context.hasNodeSelectString(node, "Text", &m_skinText)) {
        setText(m_skinText);
    }

    // Alignment
    QString alignment;
    if (context.hasNodeSelectString(node, "Alignment", &alignment)) {
        alignment = alignment.toLower();
        if (alignment == "right") {
            setAlignment(Qt::AlignRight | Qt::AlignVCenter);
        } else if (alignment == "center") {
            setAlignment(Qt::AlignHCenter | Qt::AlignVCenter);
        } else if (alignment == "left") {
            setAlignment(Qt::AlignLeft | Qt::AlignVCenter);
        } else {
            qDebug() << "WLabel::setup(): Alignment =" << alignment <<
                    " unknown, use right, center or left";
        }
    }

    // Adds an ellipsis to truncated text
    QString elide;
    if (context.hasNodeSelectString(node, "Elide", &elide)) {
        elide = elide.toLower();
        if (elide == "right") {
            m_elideMode = Qt::ElideRight;
        } else if (elide == "middle") {
            m_elideMode = Qt::ElideMiddle;
        } else if (elide == "left") {
            m_elideMode = Qt::ElideLeft;
        } else if (elide == "scroll") {
            m_elideMode = Qt::ElideNone;
            m_scrollText = true;
            setTextFormat(Qt::PlainText);
        } else if (elide == "none") {
            m_elideMode = Qt::ElideNone;
        } else {
            qDebug() << "WLabel::setup(): Elide =" << elide <<
                    "unknown, use right, middle, left, scroll or none.";
        }
    }
    setText(m_longText);
}

void WLabel::applyFontFeatures() {
#if QT_VERSION >= QT_VERSION_CHECK(6, 7, 0)
    if (m_bTabularNumbers) {
        // OpenType's "tnum" feature gives every digit the same advance width,
        // preventing changing numeric text from shifting. Apply it after skin
        // styling so the selected font keeps this feature.
        QFont tabularFont = font();
        tabularFont.setFeature("tnum", 1);
        setFont(tabularFont);
    }
#endif
}

QString WLabel::text() const {
    return m_longText;
}

void WLabel::setText(const QString& text) {
    const bool changed = m_longText != text;
    m_longText = text;
    if (m_scrollText) {
        if (changed) {
            m_scrollClock.restart();
        }
        setAccessibleName(m_longText);
        updateScrolling();
    } else if (m_elideMode != Qt::ElideNone) {
        QFontMetrics metrics(font());
        // Measure the text for the optimum label width
        // frameWidth() is the maximum of the sum of margin, border and padding
        // width of the left and the right side.
        m_widthHint = metrics.size(0, m_longText).width() + 2 * frameWidth();
        QString elidedText = metrics.elidedText(
                m_longText, m_elideMode, width() - 2 * frameWidth());
        QLabel::setText(elidedText);
    } else {
        QLabel::setText(m_longText);
    }
}

bool WLabel::event(QEvent* pEvent) {
    if (pEvent->type() == QEvent::Hide) {
        m_scrollTimer.stop();
        m_scrollClock.invalidate();
    } else if (pEvent->type() == QEvent::Show && m_scrollText) {
        updateScrolling();
    }
    if (pEvent->type() == QEvent::ToolTip) {
        updateTooltip();
    } else if (pEvent->type() == QEvent::FontChange) {
        const QFont& fonti = font();
        // Change the new font on the fly by casting away its constancy
        // using setFont() here, would results into a recursive loop
        // resetting the font to the original css values.
        // Only scale pixel size fonts, point size fonts are scaled by the OS
        if (fonti.pixelSize() > 0) {
            const_cast<QFont&>(fonti).setPixelSize(
                    static_cast<int>(fonti.pixelSize() * m_scaleFactor));
        }
        // measure text with the new font
        setText(m_longText);
    }
    return QLabel::event(pEvent);
}

void WLabel::resizeEvent(QResizeEvent* event) {
    QLabel::resizeEvent(event);
    m_scrollClock.invalidate();
    setText(m_longText);
}

QRect WLabel::scrollRect() const {
    QRect area = contentsRect().adjusted(margin(), margin(), -margin(), -margin());
    const int textIndent = indent() >= 0 ? indent() :
            (frameWidth() > 0 ? fontMetrics().horizontalAdvance(QLatin1Char('x')) / 2 : 0);
    area.adjust(textIndent, 0, 0, 0);
    return area;
}

void WLabel::updateScrolling() {
    const int available = scrollRect().width();
    m_scrollOverflow = available > 0 && fontMetrics().horizontalAdvance(m_longText) > available;
    // Let QLabel draw the frame/background in both modes; only overflowing
    // text is custom-painted. Palette and CSS remain authoritative in Day/Night.
    QLabel::setText(m_scrollOverflow ? QString() : m_longText);
    if (m_scrollOverflow && isVisible()) {
        if (!m_scrollClock.isValid()) {
            m_scrollClock.start();
        }
        m_scrollTimer.start();
    } else {
        m_scrollTimer.stop();
        m_scrollClock.invalidate();
    }
    update();
}

void WLabel::paintEvent(QPaintEvent* event) {
    QLabel::paintEvent(event);
    if (!m_scrollText || !m_scrollOverflow) {
        return;
    }
    const QRect area = scrollRect();
    const int width = fontMetrics().horizontalAdvance(m_longText);
    const double offset = mixxx::textScrollOffset(
            m_scrollClock.isValid() ? m_scrollClock.elapsed() : 0,
            width - area.width(), 30.0 * m_scaleFactor);
    QPainter painter(this);
    painter.setClipRect(area);
    painter.setPen(palette().color(isEnabled() ? QPalette::Active : QPalette::Disabled,
            foregroundRole()));
    painter.drawText(QRectF(area.x() - offset, area.y(), width, area.height()),
            Qt::AlignLeft | Qt::AlignVCenter | Qt::TextSingleLine, m_longText);
}

void WLabel::fillDebugTooltip(QStringList* debug) {
    WBaseWidget::fillDebugTooltip(debug);
    *debug << QString("Text: \"%1\"").arg(text());
}

int WLabel::getHighlight() const {
    return m_highlight;
}

void WLabel::setHighlight(int highlight) {
    if (m_highlight == highlight) {
        return;
    }
    m_highlight = highlight;
    emit highlightChanged(m_highlight);
}

QSize WLabel::sizeHint() const {
    // make sure the sizeHint fits for the entire string.
    QSize size = QLabel::sizeHint();
    if (m_scrollText) {
        // A long title must not force the deck or its waveform to grow/shrink.
        size.setWidth(0);
    } else if (m_elideMode != Qt::ElideNone) {
        size.setWidth(m_widthHint);
    }
    return size;
}
