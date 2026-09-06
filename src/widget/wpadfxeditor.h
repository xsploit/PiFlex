#pragma once

#include <array>
#include <QAbstractItemView>
#include <QComboBox>
#include <QFrame>
#include <QGridLayout>
#include <QLabel>
#include <QPushButton>
#include <QSignalBlocker>
#include <QStyledItemDelegate>
#include <QScroller>
#include <QVBoxLayout>
#include "control/controlproxy.h"
#include "widget/wbasewidget.h"

class QDomNode;
class SkinContext;

// GUI-only view of existing versioned controls: no second assignment store,
// no settings writes on refresh, no work in the audio callback.
class WPadFxEditor : public QWidget, public WBaseWidget {
  public:
    explicit WPadFxEditor(QWidget* parent = nullptr) : QWidget(parent), WBaseWidget(this) {
        setObjectName("PadFxGridUI");
        setMinimumSize(960, 820);
        auto* layout = new QVBoxLayout(this);
        layout->setContentsMargins(20, 16, 20, 16);
        layout->setSpacing(14);
        auto* title = new QLabel(tr("PAD FX  /  8 PADS PER BANK"), this);
        title->setObjectName("PadFxTitle");
        layout->addWidget(title);
        auto* selectors = new QHBoxLayout;
        selectors->addWidget(new QLabel(tr("Deck"), this));
        m_deck = combo("PadFxDeck", {tr("Deck 1"), tr("Deck 2"), tr("Deck 3"), tr("Deck 4")});
        selectors->addWidget(m_deck, 1);
        selectors->addWidget(new QLabel(tr("Bank"), this));
        m_bank = combo("PadFxBank", {tr("NORMAL · pads 1–8"), tr("SHIFT · pads 1–8")});
        selectors->addWidget(m_bank, 2);
        auto* stop = new QPushButton(tr("STOP ALL PAD FX"), this);
        stop->setObjectName("PadFxStop"); stop->setMinimumHeight(52);
        selectors->addWidget(stop, 2); layout->addLayout(selectors);
        auto* hint = new QLabel(tr("Choose an effect directly. Changes are saved and apply on the next pad press."), this);
        hint->setWordWrap(true); layout->addWidget(hint);
        auto* grid = new QGridLayout; grid->setSpacing(14);
        const std::array<QStringList, 4> choices = {
            QStringList{tr("Roll 1/2"), tr("Sweep"), tr("Flanger 16"), tr("Release Brake 3/4"), tr("Echo 1/4"), tr("Echo 1/2"), tr("Reverb"), tr("Release Echo 1/2"), tr("Trans 1/2"), tr("Crush"), tr("Filter LFO 4"), tr("Release Backspin 4"), tr("MT Delay 1/8 (approx)"), tr("Dub Echo (approx)"), tr("Space (approx)"), tr("Release Echo 1"), tr("Off")},
            QStringList{tr("Default timing"), tr("1/8 beat"), tr("1/4 beat"), tr("1/2 beat"), tr("3/4 beat"), tr("1 beat"), tr("2 beats")},
            QStringList{tr("Disabled · 0%"), tr("Strength · 25%"), tr("Strength · 50%"), tr("Strength · 75%"), tr("Strength · 100%")},
            QStringList{tr("Momentary"), tr("Toggle")}};
        for (int pad = 0; pad < 8; ++pad) {
            auto& card = m_cards[pad]; card.frame = new QFrame(this);
            card.frame->setObjectName(QStringLiteral("PadFxCard%1").arg(pad + 1));
            auto* column = new QVBoxLayout(card.frame);
            column->setContentsMargins(14, 10, 14, 12); column->setSpacing(8);
            card.label = new QLabel(card.frame); column->addWidget(card.label);
            for (int field = 0; field < 4; ++field) {
                card.fields[field] = combo(QStringLiteral("PadFxPad%1Field%2").arg(pad + 1).arg(field), choices[field]);
                column->addWidget(card.fields[field]);
                connect(card.fields[field], QOverload<int>::of(&QComboBox::activated), this,
                        [this, pad, field](int value) { m_controls[index(pad)][field]->set(value); });
            }
            card.fields[1]->setToolTip(tr("Beat override for Echo and delay assignments only."));
            card.fields[2]->setToolTip(tr("Native strength; transport speed unchanged. 0% disables the pad."));
            card.fields[3]->setToolTip(tr("Toggle is available only for Release Echo."));
            auto* reset = new QPushButton(tr("Reset this pad"), card.frame);
            reset->setObjectName(QStringLiteral("PadFxReset%1").arg(pad + 1)); reset->setMinimumHeight(44);
            column->addWidget(reset);
            connect(reset, &QPushButton::clicked, this, [this, pad] {
                const int slot = index(pad);
                for (int field = 0; field < 4; ++field) m_controls[slot][field]->set(field == 0 ? slot % 16 : field == 2 ? 4 : 0);
            });
            grid->addWidget(card.frame, pad / 4, pad % 4); grid->setColumnStretch(pad % 4, 1);
        }
        layout->addLayout(grid, 1);
        auto* legend = new QLabel(tr("CYAN · echo/delay    PURPLE · modulation    GOLD · space/reverb    CORAL · rhythm/transport    GREY · off"), this);
        legend->setWordWrap(true); layout->addWidget(legend);
        const char* fields[] = {"effect", "beat", "strength", "hold"};
        for (int slot = 0; slot < 64; ++slot) {
            for (int field = 0; field < 4; ++field) {
                auto* control = new ControlProxy(QStringLiteral("[PadFX]"),
                        QStringLiteral("d%1_s%2_%3").arg(slot / 16 + 1).arg(slot % 16).arg(fields[field]), this);
                m_controls[slot][field] = control;
                control->connectValueChanged(this, [this, slot](double) {
                    if (slot >= index(0) && slot <= index(7)) refreshCard(slot % 8);
                });
            }
        }
        auto* clear = new ControlProxy(QStringLiteral("[PadFX]"), QStringLiteral("clear_all"), this);
        connect(stop, &QPushButton::clicked, this, [clear] { clear->set(1); clear->set(0); });
        connect(m_deck, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int) { refresh(); });
        connect(m_bank, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this](int) { refresh(); });
        refresh();
    }
    void setup(const QDomNode&, const SkinContext&) {
        setStyleSheet(QStringLiteral(
            "#PadFxGridUI { background:#101014; }"
            "#PadFxGridUI QLabel { color:#dfe5f0; font-size:18px; background:transparent; }"
            "#PadFxGridUI #PadFxTitle { font-size:28px; font-weight:bold; }"
            "#PadFxGridUI QComboBox { color:#f4f6fb; background:#242630; border:1px solid #515564; border-radius:6px; padding:8px; font-size:18px; }"
            "#PadFxGridUI QComboBox::drop-down { width:28px; border-left:1px solid #515564; }"
            "#PadFxGridUI QComboBox::down-arrow { image:url(skin:icons/dropdown_arrow.svg); width:14px; height:10px; }"
            "#PadFxGridUI QComboBox:disabled { color:#858995; background:#1c1d24; }"
            "#PadFxGridUI QComboBox QAbstractItemView { color:#f4f6fb; background:#242630; selection-background-color:#315775; font-size:20px; }"
            "#PadFxGridUI QComboBox QAbstractItemView::item { min-height:44px; padding:4px; }"
            "#PadFxGridUI QPushButton { color:#edf0fa; background:#303340; border:1px solid #565b6b; border-radius:6px; font-size:17px; padding:8px; }"
            "#PadFxGridUI QPushButton:pressed { background:#4d5367; }"
            "#PadFxGridUI #PadFxStop { color:#ffbbc0; border-color:#e65c6c; background:#40212b; }"));
    }
  private:
    struct Card { QFrame* frame{}; QLabel* label{}; std::array<QComboBox*, 4> fields{}; };
    QComboBox* combo(const QString& name, const QStringList& choices) {
        auto* box = new QComboBox(this); box->setObjectName(name); box->addItems(choices);
        box->setMinimumHeight(52); box->setMinimumWidth(0);
        box->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon); box->setMinimumContentsLength(8);
        box->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Fixed); box->setMaxVisibleItems(8);
        box->setItemDelegate(new QStyledItemDelegate(box));
        box->view()->setVerticalScrollMode(QAbstractItemView::ScrollPerPixel);
        QScroller::grabGesture(box->view()->viewport(), QScroller::TouchGesture);
        return box;
    }
    int index(int pad) const { return m_deck->currentIndex() * 16 + m_bank->currentIndex() * 8 + pad; }
    void refresh() {
        for (int pad = 0; pad < 8; ++pad) refreshCard(pad);
    }
    void refreshCard(int pad) {
            auto& card = m_cards[pad]; const int slot = index(pad);
            for (int field = 0; field < 4; ++field) {
                const QSignalBlocker blocker(card.fields[field]);
                card.fields[field]->setCurrentIndex(static_cast<int>(m_controls[slot][field]->get()));
            }
            const int effect = card.fields[0]->currentIndex();
            const bool delay = effect == 4 || effect == 5 || effect == 7 || effect == 12 || effect == 13 || effect == 15;
            const bool release = effect == 7 || effect == 15;
            const bool space = effect == 6 || effect == 14;
            const bool mod = effect == 1 || effect == 2 || effect == 9 || effect == 10;
            const bool off = effect == 16 || card.fields[2]->currentIndex() == 0;
            const QString color = off ? "#858995" : delay ? "#37cdeb" : space ? "#efc46b" : mod ? "#b99aff" : "#ff8a81";
            const QString category = off ? tr("OFF") : delay ? tr("ECHO / DELAY") : space ? tr("SPACE") : mod ? tr("MODULATION") : tr("RHYTHM / MOVE");
            card.label->setText(tr("PAD %1 · %2").arg(pad + 1).arg(category));
            const auto labelStyle = QStringLiteral("color:%1; font-weight:bold; font-size:17px;").arg(color);
            if (card.label->styleSheet() != labelStyle) card.label->setStyleSheet(labelStyle);
            const auto frameStyle = QStringLiteral("#%1 { background:#191b23; border:1px solid #343846; border-top:4px solid %2; border-radius:8px; }").arg(card.frame->objectName(), color);
            if (card.frame->styleSheet() != frameStyle) card.frame->setStyleSheet(frameStyle);
            card.fields[1]->setEnabled(delay); card.fields[3]->setEnabled(release);
            if (!release) { const QSignalBlocker blocker(card.fields[3]); card.fields[3]->setCurrentIndex(0); }
    }
    QComboBox* m_deck{}; QComboBox* m_bank{};
    std::array<Card, 8> m_cards{};
    std::array<std::array<ControlProxy*, 4>, 64> m_controls{};
};
