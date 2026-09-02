#pragma once

#include <QJsonArray>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QPointer>
#include <QSet>
#include <QTimer>
#include <QVariantMap>
#include <memory>

#include "library/libraryfeature.h"
#include "library/treeitemmodel.h"
#include "util/parented_ptr.h"

class ControlProxy;
class ControlPushButton;
class EdmcBrowserView;
class QNetworkReply;

// Native BiteDJ front-end for the out-of-process EDMC companion. Website,
// Chromium, and download work remain outside BiteDJ; this feature only makes
// asynchronous loopback API calls and loads completed local files through the
// normal Mixxx library/player path.
class EdmcFeature final : public LibraryFeature {
    Q_OBJECT

  public:
    EdmcFeature(Library* pLibrary, UserSettingsPointer pConfig);
    ~EdmcFeature() override;

    QVariant title() override;
    TreeItemModel* sidebarModel() const override;
    void bindLibraryWidget(WLibrary* pLibraryWidget,
            KeyboardEventFilter* pKeyboard) override;

  public slots:
    void activate() override;

  private slots:
    void activateSelected();
    void back();
    void downloadSelected();
    void previewSelected();
    void loadSelectedDeck1();
    void loadSelectedDeck2();
    void onReplyFinished();
    void refreshAll();
    void pushSettings();
    void openSetup();

  private:
    enum class HttpMethod {
        Get,
        Post,
        Put,
    };

    void request(const QString& operation,
            HttpMethod method,
            const QString& path,
            const QJsonObject& body = {});
    void openGenre(const QVariantMap& row);
    void openFormats(qint64 topicId);
    qint64 selectedTopicId() const;
    bool isViewActive() const;
    void render();
    QJsonObject releaseForTopic(qint64 topicId) const;
    void loadDownloadedTrack(qint64 topicId, const QString& group, bool play);
    void addCompletedDownloadToLibrary(const QJsonObject& job);
    bool hasActiveJobs() const;

    enum class Screen {
        Categories,
        Genres,
        Releases,
        Formats,
    };

    parented_ptr<TreeItemModel> m_pSidebarModel;
    parented_ptr<ControlProxy> m_pLoadDeck1Control;
    parented_ptr<ControlProxy> m_pLoadDeck2Control;
    parented_ptr<ControlProxy> m_pPreviewPlayControl;
    parented_ptr<ControlProxy> m_pPreviewStopControl;
    std::unique_ptr<ControlPushButton> m_pDownloadFolderMode;
    std::unique_ptr<ControlPushButton> m_pOrganizeByGenre;
    std::unique_ptr<ControlPushButton> m_pAutoAddDownloads;
    std::unique_ptr<ControlPushButton> m_pOpenSetup;
    QPointer<EdmcBrowserView> m_pView;
    QNetworkAccessManager m_network;
    QTimer m_pollTimer;
    QJsonObject m_status;
    QJsonArray m_catalog;
    QJsonObject m_browse;
    QJsonArray m_jobs;
    QSet<QString> m_importedDownloads;
    QString m_message;
    QString m_trackedJobId;
    QString m_trackedAction;
    Screen m_screen{Screen::Categories};
    int m_selectedCategory{-1};
    qint64 m_selectedTopicId{0};
    int m_pendingRequests{0};
};
