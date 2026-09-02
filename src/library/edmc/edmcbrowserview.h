#pragma once

#include <QList>
#include <QVariantMap>
#include <QWidget>

#include "library/libraryview.h"

class QLabel;
class QListWidget;
class QLineEdit;
class QPushButton;

// A controller-first EDMC browser. The focused QListWidget deliberately uses
// ordinary Up/Down/Return key handling so Mixxx's [Library] controls and the
// FLX6 browse encoder operate it exactly like a native library list.
class EdmcBrowserView final : public QWidget, public LibraryView {
    Q_OBJECT

  public:
    explicit EdmcBrowserView(QWidget* parent = nullptr);

    void onShow() override;
    bool hasFocus() const override;
    void setFocus() override;

    void setHeader(const QString& title,
            const QString& status,
            const QString& message,
            bool working);
    void setRows(const QList<QVariantMap>& rows);
    QVariantMap selectedRow() const;
    void setBackEnabled(bool enabled);
    void setPreviewActive(bool active);

    // Direct controller entry points. These intentionally avoid synthesizing
    // keyboard events so Browse/BACK keep working even if touch interaction
    // moved Qt focus to another widget.
    void moveSelection(int steps);
    void activateSelection();
    bool navigateBack();

  signals:
    void activateRequested();
    void backRequested();
    void refreshRequested();
    void downloadRequested();
    void previewRequested();
    void loadDeck1Requested();
    void loadDeck2Requested();
    void searchRequested(const QString& query);

  private slots:
    void updateActions();

  protected:
    bool eventFilter(QObject* watched, QEvent* event) override;

  private:
    QLabel* m_pTitle{nullptr};
    QLabel* m_pStatus{nullptr};
    QLabel* m_pMessage{nullptr};
    QLineEdit* m_pSearch{nullptr};
    QListWidget* m_pRows{nullptr};
    QPushButton* m_pBack{nullptr};
    QPushButton* m_pOpen{nullptr};
    QPushButton* m_pDownload{nullptr};
    QPushButton* m_pPreview{nullptr};
    QPushButton* m_pLoad1{nullptr};
    QPushButton* m_pLoad2{nullptr};
    bool m_previewActive{false};
};
