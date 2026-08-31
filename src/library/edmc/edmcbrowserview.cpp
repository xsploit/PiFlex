#include "library/edmc/edmcbrowserview.h"

#include <QEvent>
#include <QHBoxLayout>
#include <QKeyEvent>
#include <QLabel>
#include <QListWidget>
#include <QPushButton>
#include <QSizePolicy>
#include <QVBoxLayout>

#include "moc_edmcbrowserview.cpp"

namespace {

QPushButton* actionButton(const QString& text, QWidget* parent) {
    auto* pButton = new QPushButton(text, parent);
    pButton->setMinimumHeight(72);
    pButton->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
    pButton->setFocusPolicy(Qt::NoFocus);
    return pButton;
}

} // namespace

EdmcBrowserView::EdmcBrowserView(QWidget* parent)
        : QWidget(parent) {
    setObjectName(QStringLiteral("EdmcBrowserView"));
    setStyleSheet(QStringLiteral(R"(
        #EdmcBrowserView { background: #15151a; color: #efeff4; }
        QLabel { color: #efeff4; }
        QLabel#EdmcTitle { font-size: 30px; font-weight: 800; }
        QLabel#EdmcStatus { font-size: 18px; color: #aeb0bd; }
        QLabel#EdmcMessage { font-size: 18px; color: #ded8ff; padding: 5px 0; }
        QListWidget {
            background: #191920;
            color: #f3f3f7;
            border: 1px solid #363641;
            outline: 0;
            font-size: 22px;
            padding: 4px;
        }
        QListWidget::item {
            min-height: 62px;
            padding: 10px 14px;
            margin: 2px;
            border-bottom: 1px solid #33333d;
        }
        QListWidget::item:selected {
            background: #6657d9;
            color: white;
            border: 2px solid #b9adff;
        }
        QPushButton {
            background: #34343f;
            color: white;
            border: 1px solid #5b5b69;
            border-radius: 7px;
            font-size: 21px;
            font-weight: 750;
            padding: 8px;
        }
        QPushButton:pressed { background: #7769e8; }
        QPushButton:disabled { color: #777783; background: #24242b; }
        QPushButton#EdmcOpen { background: #6657d9; }
        QPushButton#EdmcDownload { background: #a65c24; }
        QPushButton#EdmcPreview { background: #236d9d; }
        QPushButton#EdmcLoad { background: #27734a; }
    )"));

    auto* pLayout = new QVBoxLayout(this);
    pLayout->setContentsMargins(18, 12, 18, 12);
    pLayout->setSpacing(7);

    m_pTitle = new QLabel(this);
    m_pTitle->setObjectName(QStringLiteral("EdmcTitle"));
    m_pStatus = new QLabel(this);
    m_pStatus->setObjectName(QStringLiteral("EdmcStatus"));
    m_pMessage = new QLabel(this);
    m_pMessage->setObjectName(QStringLiteral("EdmcMessage"));
    pLayout->addWidget(m_pTitle);
    pLayout->addWidget(m_pStatus);
    pLayout->addWidget(m_pMessage);

    m_pRows = new QListWidget(this);
    m_pRows->setVerticalScrollMode(QAbstractItemView::ScrollPerPixel);
    m_pRows->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    m_pRows->setWordWrap(false);
    m_pRows->installEventFilter(this);
    pLayout->addWidget(m_pRows, 1);

    auto* pActions = new QHBoxLayout();
    pActions->setSpacing(8);
    m_pBack = actionButton(tr("BACK"), this);
    m_pOpen = actionButton(tr("OPEN"), this);
    m_pOpen->setObjectName(QStringLiteral("EdmcOpen"));
    m_pDownload = actionButton(tr("DOWNLOAD"), this);
    m_pDownload->setObjectName(QStringLiteral("EdmcDownload"));
    m_pPreview = actionButton(tr("PREVIEW"), this);
    m_pPreview->setObjectName(QStringLiteral("EdmcPreview"));
    m_pLoad1 = actionButton(tr("LOAD 1"), this);
    m_pLoad1->setObjectName(QStringLiteral("EdmcLoad"));
    m_pLoad2 = actionButton(tr("LOAD 2"), this);
    m_pLoad2->setObjectName(QStringLiteral("EdmcLoad"));
    for (auto* pButton : {m_pBack, m_pOpen, m_pDownload, m_pPreview, m_pLoad1, m_pLoad2}) {
        pActions->addWidget(pButton);
    }
    pLayout->addLayout(pActions);

    connect(m_pRows, &QListWidget::currentRowChanged, this, &EdmcBrowserView::updateActions);
    connect(m_pRows, &QListWidget::itemActivated, this, [this] {
        emit activateRequested();
    });
    connect(m_pBack, &QPushButton::clicked, this, &EdmcBrowserView::backRequested);
    connect(m_pOpen, &QPushButton::clicked, this, &EdmcBrowserView::activateRequested);
    connect(m_pDownload, &QPushButton::clicked, this, &EdmcBrowserView::downloadRequested);
    connect(m_pPreview, &QPushButton::clicked, this, &EdmcBrowserView::previewRequested);
    connect(m_pLoad1, &QPushButton::clicked, this, &EdmcBrowserView::loadDeck1Requested);
    connect(m_pLoad2, &QPushButton::clicked, this, &EdmcBrowserView::loadDeck2Requested);
}

void EdmcBrowserView::onShow() {
    setFocus();
}

bool EdmcBrowserView::hasFocus() const {
    return m_pRows && m_pRows->hasFocus();
}

void EdmcBrowserView::setFocus() {
    if (m_pRows) {
        m_pRows->setFocus();
    }
}

void EdmcBrowserView::setHeader(const QString& title,
        const QString& status,
        const QString& message,
        bool working) {
    m_pTitle->setText(title);
    m_pStatus->setText(status);
    m_pMessage->setText(working ? tr("Working...  %1").arg(message) : message);
    m_pMessage->setVisible(!m_pMessage->text().isEmpty());
}

void EdmcBrowserView::setRows(const QList<QVariantMap>& rows) {
    const QString previousKey = selectedRow().value(QStringLiteral("key")).toString();
    m_pRows->clear();
    int selectedIndex = -1;
    for (int index = 0; index < rows.size(); ++index) {
        const QVariantMap& row = rows.at(index);
        auto* pItem = new QListWidgetItem(row.value(QStringLiteral("label")).toString(), m_pRows);
        pItem->setData(Qt::UserRole, row);
        pItem->setSizeHint(QSize(0, 70));
        if (!previousKey.isEmpty() && row.value(QStringLiteral("key")).toString() == previousKey) {
            selectedIndex = index;
        }
    }
    if (selectedIndex < 0 && !rows.isEmpty()) {
        selectedIndex = 0;
    }
    if (selectedIndex >= 0) {
        m_pRows->setCurrentRow(selectedIndex);
        m_pRows->scrollToItem(m_pRows->currentItem(), QAbstractItemView::PositionAtCenter);
    }
    updateActions();
}

QVariantMap EdmcBrowserView::selectedRow() const {
    const auto* pItem = m_pRows ? m_pRows->currentItem() : nullptr;
    return pItem ? pItem->data(Qt::UserRole).toMap() : QVariantMap{};
}

void EdmcBrowserView::setBackEnabled(bool enabled) {
    m_pBack->setEnabled(enabled);
}

void EdmcBrowserView::setPreviewActive(bool active) {
    m_previewActive = active;
    updateActions();
}

void EdmcBrowserView::moveSelection(int steps) {
    if (!m_pRows || m_pRows->count() == 0 || steps == 0) {
        return;
    }
    const int current = qMax(0, m_pRows->currentRow());
    const int target = qBound(0, current + steps, m_pRows->count() - 1);
    m_pRows->setCurrentRow(target);
    m_pRows->scrollToItem(m_pRows->currentItem(), QAbstractItemView::PositionAtCenter);
    m_pRows->setFocus();
}

void EdmcBrowserView::activateSelection() {
    if (m_pRows && m_pRows->currentItem()) {
        emit activateRequested();
    }
}

bool EdmcBrowserView::navigateBack() {
    if (!m_pBack || !m_pBack->isEnabled()) {
        return false;
    }
    emit backRequested();
    return true;
}

void EdmcBrowserView::updateActions() {
    const QVariantMap row = selectedRow();
    const QString action = row.value(QStringLiteral("action")).toString();
    const bool isRelease = action == QStringLiteral("release");
    const bool isProvider = action == QStringLiteral("provider");
    const bool downloaded = row.value(QStringLiteral("downloaded")).toBool();
    const bool busy = row.value(QStringLiteral("busy")).toBool();
    m_pOpen->setEnabled(!row.isEmpty());
    m_pOpen->setText(isProvider
                    ? tr("DOWNLOAD")
                    : isRelease
                    ? (downloaded
                                      ? (m_previewActive ? tr("STOP PREVIEW") : tr("PREVIEW"))
                                      : (busy ? tr("DOWNLOADING") : tr("GET TRACK")))
                    : tr("OPEN"));
    m_pDownload->setEnabled((isRelease && !downloaded && !busy) || isProvider);
    m_pPreview->setEnabled(m_previewActive || (isRelease && downloaded));
    m_pPreview->setText(m_previewActive ? tr("STOP PREVIEW") : tr("PREVIEW"));
    m_pLoad1->setEnabled(isRelease && downloaded);
    m_pLoad2->setEnabled(isRelease && downloaded);
}

bool EdmcBrowserView::eventFilter(QObject* watched, QEvent* event) {
    if (watched == m_pRows && event->type() == QEvent::KeyPress) {
        auto* pKeyEvent = static_cast<QKeyEvent*>(event);
        if (pKeyEvent->key() == Qt::Key_Backspace || pKeyEvent->key() == Qt::Key_Escape ||
                pKeyEvent->key() == Qt::Key_Left) {
            emit backRequested();
            return true;
        }
    }
    return QWidget::eventFilter(watched, event);
}
