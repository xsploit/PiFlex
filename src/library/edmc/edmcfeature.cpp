#include "library/edmc/edmcfeature.h"

#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonParseError>
#include <QNetworkReply>
#include <QNetworkRequest>

#include "control/controlproxy.h"
#include "control/controlpushbutton.h"
#include "controllers/keyboard/keyboardeventfilter.h"
#include "library/edmc/edmcbrowserview.h"
#include "library/library.h"
#include "library/trackcollectionmanager.h"
#include "library/treeitem.h"
#include "moc_edmcfeature.cpp"
#include "track/trackref.h"
#include "widget/wlibrary.h"

namespace {

const QString kViewName = QStringLiteral("EDMCHOME");
const QUrl kApiBase(QStringLiteral("http://127.0.0.1:17642"));
const QString kEdmcGroup = QStringLiteral("[EDMC]");

QString fileOnSelectedUsb(const QString& usbRoot, const QString& relativePath) {
    if (usbRoot.isEmpty() || relativePath.isEmpty() || QDir::isAbsolutePath(relativePath)) {
        return {};
    }
    const QString cleanRelativePath = QDir::cleanPath(relativePath);
    if (cleanRelativePath == QStringLiteral("..") ||
            cleanRelativePath.startsWith(QStringLiteral("../")) ||
            cleanRelativePath.startsWith(QStringLiteral("..\\"))) {
        return {};
    }
    return QDir(usbRoot).absoluteFilePath(cleanRelativePath);
}

} // namespace

EdmcFeature::EdmcFeature(Library* pLibrary, UserSettingsPointer pConfig)
        : LibraryFeature(pLibrary, pConfig, QStringLiteral("computer")),
          m_pSidebarModel(make_parented<TreeItemModel>(this)) {
    m_pSidebarModel->setRootItem(TreeItem::newRoot(this));
    m_pollTimer.setInterval(1500);
    connect(&m_pollTimer, &QTimer::timeout, this, &EdmcFeature::refreshAll);

    m_pLoadDeck1Control = make_parented<ControlProxy>(
            QStringLiteral("[Channel1]"), QStringLiteral("LoadSelectedTrack"), this);
    m_pLoadDeck2Control = make_parented<ControlProxy>(
            QStringLiteral("[Channel2]"), QStringLiteral("LoadSelectedTrack"), this);
    m_pPreviewPlayControl = make_parented<ControlProxy>(
            QStringLiteral("[PreviewDeck1]"), QStringLiteral("play"), this);
    m_pPreviewStopControl = make_parented<ControlProxy>(
            QStringLiteral("[PreviewDeck1]"), QStringLiteral("stop"), this);

    m_pDownloadFolderMode = std::make_unique<ControlPushButton>(
            ConfigKey(kEdmcGroup, QStringLiteral("download_folder_mode")), true, 0.0);
    m_pDownloadFolderMode->setButtonMode(ControlPushButton::TOGGLE);
    m_pDownloadFolderMode->setStates(4);
    m_pOrganizeByGenre = std::make_unique<ControlPushButton>(
            ConfigKey(kEdmcGroup, QStringLiteral("organize_by_genre")), true, 1.0);
    m_pOrganizeByGenre->setButtonMode(ControlPushButton::TOGGLE);
    m_pOrganizeByGenre->setStates(2);
    m_pAutoAddDownloads = std::make_unique<ControlPushButton>(
            ConfigKey(kEdmcGroup, QStringLiteral("auto_add_downloads")), true, 1.0);
    m_pAutoAddDownloads->setButtonMode(ControlPushButton::TOGGLE);
    m_pAutoAddDownloads->setStates(2);
    m_pOpenSetup = std::make_unique<ControlPushButton>(
            ConfigKey(kEdmcGroup, QStringLiteral("open_setup")));

    connect(m_pDownloadFolderMode.get(),
            &ControlPushButton::valueChanged,
            this,
            &EdmcFeature::pushSettings);
    connect(m_pOrganizeByGenre.get(),
            &ControlPushButton::valueChanged,
            this,
            &EdmcFeature::pushSettings);
    connect(m_pOpenSetup.get(),
            &ControlPushButton::valueChanged,
            this,
            [this](double value) {
                if (value > 0.0) {
                    openSetup();
                }
            });
    m_pLoadDeck1Control->connectValueChanged(this, [this](double value) {
        if (value > 0.0 && isViewActive()) {
            loadSelectedDeck1();
        }
    });
    m_pLoadDeck2Control->connectValueChanged(this, [this](double value) {
        if (value > 0.0 && isViewActive()) {
            loadSelectedDeck2();
        }
    });
    m_pPreviewPlayControl->connectValueChanged(this, [this](double value) {
        if (m_pView) {
            m_pView->setPreviewActive(value > 0.0);
        }
    });
}

EdmcFeature::~EdmcFeature() = default;

QVariant EdmcFeature::title() {
    return tr("EDMC");
}

TreeItemModel* EdmcFeature::sidebarModel() const {
    return m_pSidebarModel;
}

void EdmcFeature::bindLibraryWidget(
        WLibrary* pLibraryWidget, KeyboardEventFilter* pKeyboard) {
    Q_UNUSED(pKeyboard);
    auto* pView = new EdmcBrowserView(pLibraryWidget);
    connect(pView, &EdmcBrowserView::activateRequested, this, &EdmcFeature::activateSelected);
    connect(pView, &EdmcBrowserView::backRequested, this, &EdmcFeature::back);
    connect(pView, &EdmcBrowserView::refreshRequested, this, &EdmcFeature::refreshAll);
    connect(pView, &EdmcBrowserView::downloadRequested, this, &EdmcFeature::downloadSelected);
    connect(pView, &EdmcBrowserView::previewRequested, this, &EdmcFeature::previewSelected);
    connect(pView, &EdmcBrowserView::loadDeck1Requested, this, &EdmcFeature::loadSelectedDeck1);
    connect(pView, &EdmcBrowserView::loadDeck2Requested, this, &EdmcFeature::loadSelectedDeck2);
    connect(pView, &EdmcBrowserView::searchRequested, this, &EdmcFeature::searchMusic);
    pLibraryWidget->registerView(kViewName, pView);
    m_pView = pView;
    render();
}

void EdmcFeature::activate() {
    emit switchToView(kViewName);
    emit disableSearch();
    emit enableCoverArtDisplay(false);
    m_screen = Screen::Categories;
    // Re-apply the saved BiteDJ choices whenever EDMC is opened. This also
    // recovers cleanly if the companion started after BiteDJ.
    pushSettings();
    if (!m_pollTimer.isActive()) {
        m_pollTimer.start();
    }
}

void EdmcFeature::pushSettings() {
    QJsonObject body;
    switch (qRound(m_pDownloadFolderMode->get())) {
    case 0:
        body.insert(QStringLiteral("downloadFolder"), QStringLiteral("Music/EDMC"));
        break;
    case 1:
        body.insert(QStringLiteral("downloadFolder"), QStringLiteral("Music/Downloads"));
        break;
    case 2:
        body.insert(QStringLiteral("downloadFolder"), QStringLiteral("EDMC"));
        break;
    default:
        // Custom leaves the companion's text value alone. The Setup button
        // opens the local page where the USB and arbitrary relative path live.
        break;
    }
    body.insert(QStringLiteral("organizeByGenre"), m_pOrganizeByGenre->toBool());
    request(QStringLiteral("settings-update"),
            HttpMethod::Put,
            QStringLiteral("/v1/settings"),
            body);
}

void EdmcFeature::openSetup() {
    // Opening the free-form page means its folder choice becomes authoritative
    // until the DJ explicitly picks one of the three presets again.
    m_pDownloadFolderMode->set(3.0);
    request(QStringLiteral("setup-open"),
            HttpMethod::Post,
            QStringLiteral("/v1/ui/open"));
}

void EdmcFeature::refreshAll() {
    if (m_pendingRequests > 0) {
        return;
    }
    request(QStringLiteral("status"), HttpMethod::Get, QStringLiteral("/v1/status"));
    request(QStringLiteral("catalog"), HttpMethod::Get, QStringLiteral("/v1/catalog"));
    request(QStringLiteral("browse"), HttpMethod::Get, QStringLiteral("/v1/browse"));
    request(QStringLiteral("jobs"), HttpMethod::Get, QStringLiteral("/v1/jobs"));
}

void EdmcFeature::request(const QString& operation,
        HttpMethod method,
        const QString& path,
        const QJsonObject& body) {
    QNetworkRequest networkRequest(kApiBase.resolved(QUrl(path)));
    networkRequest.setHeader(QNetworkRequest::ContentTypeHeader,
            QStringLiteral("application/json"));
    QNetworkReply* pReply = nullptr;
    if (method == HttpMethod::Post) {
        pReply = m_network.post(networkRequest, QJsonDocument(body).toJson(QJsonDocument::Compact));
    } else if (method == HttpMethod::Put) {
        pReply = m_network.put(networkRequest, QJsonDocument(body).toJson(QJsonDocument::Compact));
    } else {
        pReply = m_network.get(networkRequest);
    }
    pReply->setProperty("edmcOperation", operation);
    connect(pReply, &QNetworkReply::finished, this, &EdmcFeature::onReplyFinished);
    ++m_pendingRequests;
}

void EdmcFeature::onReplyFinished() {
    auto* pReply = qobject_cast<QNetworkReply*>(sender());
    if (!pReply) {
        return;
    }
    const QString operation = pReply->property("edmcOperation").toString();
    const QByteArray bytes = pReply->readAll();
    --m_pendingRequests;

    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(bytes, &parseError);
    if (pReply->error() != QNetworkReply::NoError || parseError.error != QJsonParseError::NoError) {
        QString detail = pReply->errorString();
        if (document.isObject() && !document.object().value(QStringLiteral("error")).toString().isEmpty()) {
            detail = document.object().value(QStringLiteral("error")).toString();
        }
        m_message = tr("EDMC companion error: %1").arg(detail);
        pReply->deleteLater();
        if (m_pendingRequests == 0) {
            render();
        }
        return;
    }

    if (operation == QStringLiteral("status") && document.isObject()) {
        m_status = document.object();
        if (m_message.startsWith(QStringLiteral("EDMC companion error:"))) {
            m_message.clear();
        }
    } else if (operation == QStringLiteral("catalog") && document.isArray()) {
        m_catalog = document.array();
    } else if (operation == QStringLiteral("browse")) {
        m_browse = document.isObject() ? document.object() : QJsonObject{};
    } else if (operation == QStringLiteral("jobs") && document.isArray()) {
        m_jobs = document.array();
        for (const QJsonValue& value : m_jobs) {
            addCompletedDownloadToLibrary(value.toObject());
        }
        if (!m_trackedJobId.isEmpty()) {
            for (const QJsonValue& value : m_jobs) {
                const QJsonObject job = value.toObject();
                if (job.value(QStringLiteral("id")).toString() != m_trackedJobId) {
                    continue;
                }
                const QString state = job.value(QStringLiteral("state")).toString();
                const QString jobMessage = job.value(QStringLiteral("message")).toString();
                if (state == QStringLiteral("queued")) {
                    m_message = tr("%1 queued").arg(m_trackedAction);
                } else if (state == QStringLiteral("running")) {
                    m_message = tr("%1: %2").arg(m_trackedAction, jobMessage);
                } else if (state == QStringLiteral("completed")) {
                    m_message = tr("%1 completed").arg(m_trackedAction);
                    m_trackedJobId.clear();
                    m_trackedAction.clear();
                } else if (state == QStringLiteral("failed")) {
                    m_message = tr("%1 failed: %2")
                                        .arg(m_trackedAction,
                                                job.value(QStringLiteral("error")).toString());
                    m_trackedJobId.clear();
                    m_trackedAction.clear();
                } else if (state == QStringLiteral("cancelled")) {
                    m_message = tr("%1 cancelled").arg(m_trackedAction);
                    m_trackedJobId.clear();
                    m_trackedAction.clear();
                }
                break;
            }
        }
    } else if (operation == QStringLiteral("settings-update") && document.isObject()) {
        m_status.insert(QStringLiteral("settings"), document.object());
        m_message = tr("EDMC download settings saved");
        QTimer::singleShot(100, this, &EdmcFeature::refreshAll);
    } else if (operation == QStringLiteral("setup-open")) {
        m_message = tr("EDMC USB and custom-folder setup opened");
    } else if (operation.startsWith(QStringLiteral("action:"))) {
        const QString action = operation.mid(QStringLiteral("action:").size());
        if (document.isObject()) {
            m_trackedJobId = document.object().value(QStringLiteral("id")).toString();
            m_trackedAction = action;
        }
        m_message = tr("%1 queued").arg(action);
        QTimer::singleShot(100, this, &EdmcFeature::refreshAll);
    }

    pReply->deleteLater();
    // refreshAll() issues a small batch of loopback requests. Rebuilding the
    // QTextBrowser after every reply resets its scroll position and looks like
    // a rapid refresh loop. Paint once after the complete snapshot arrives.
    if (m_pendingRequests == 0) {
        render();
    }
}

void EdmcFeature::addCompletedDownloadToLibrary(const QJsonObject& job) {
    if (!m_pAutoAddDownloads->toBool() ||
            job.value(QStringLiteral("kind")).toString() != QStringLiteral("download") ||
            job.value(QStringLiteral("state")).toString() != QStringLiteral("completed")) {
        return;
    }
    const QJsonObject track = job.value(QStringLiteral("result"))
                                      .toObject()
                                      .value(QStringLiteral("track"))
                                      .toObject();
    const QString relativePath = track.value(QStringLiteral("relativePath")).toString();
    const QString importKey = track.value(QStringLiteral("providerId")).toString().isEmpty()
            ? relativePath
            : track.value(QStringLiteral("providerId")).toString();
    const QString usbRoot = m_status.value(QStringLiteral("storage"))
                                    .toObject()
                                    .value(QStringLiteral("usbRoot"))
                                    .toString();
    if (relativePath.isEmpty() || importKey.isEmpty() || usbRoot.isEmpty() ||
            m_importedDownloads.contains(importKey)) {
        return;
    }
    const QString absolutePath = fileOnSelectedUsb(usbRoot, relativePath);
    if (absolutePath.isEmpty()) {
        return;
    }
    if (!QFileInfo::exists(absolutePath)) {
        return;
    }
    if (m_pLibrary->trackCollectionManager()->getOrAddTrack(
                TrackRef::fromFilePath(absolutePath))) {
        m_importedDownloads.insert(importKey);
    }
}

void EdmcFeature::activateSelected() {
    if (!m_pView) {
        return;
    }
    const QVariantMap row = m_pView->selectedRow();
    const QString action = row.value(QStringLiteral("action")).toString();
    if (action == QStringLiteral("catalog-refresh")) {
        request(QStringLiteral("action:Catalog refresh"),
                HttpMethod::Post,
                QStringLiteral("/v1/catalog/refresh"));
        return;
    }
    if (action == QStringLiteral("category")) {
        const int index = row.value(QStringLiteral("index")).toInt();
        if (index >= 0 && index < m_catalog.size()) {
            m_selectedCategory = index;
            m_screen = Screen::Genres;
            render();
        }
        return;
    }
    if (action == QStringLiteral("genre")) {
        openGenre(row);
        return;
    }
    if (action == QStringLiteral("page")) {
        const int page = row.value(QStringLiteral("page")).toInt();
        request(QStringLiteral("action:Page"),
                HttpMethod::Post,
                QStringLiteral("/v1/browse"),
                {{QStringLiteral("genreUrl"), m_browse.value(QStringLiteral("genreUrl"))},
                        {QStringLiteral("genreName"), m_browse.value(QStringLiteral("genreName"))},
                        {QStringLiteral("page"), page}});
        return;
    }
    if (action == QStringLiteral("release")) {
        if (row.value(QStringLiteral("busy")).toBool()) {
            return;
        }
        if (row.value(QStringLiteral("downloaded")).toBool()) {
            previewSelected();
        } else {
            openFormats(row.value(QStringLiteral("topicId")).toLongLong());
        }
        return;
    }
    if (action == QStringLiteral("provider")) {
        const qint64 topicId = row.value(QStringLiteral("topicId")).toLongLong();
        const QString providerId = row.value(QStringLiteral("providerId")).toString();
        if (topicId && !providerId.isEmpty()) {
            request(QStringLiteral("action:Download"),
                    HttpMethod::Post,
                    QStringLiteral("/v1/download"),
                    {{QStringLiteral("topicId"), topicId},
                            {QStringLiteral("providerId"), providerId}});
        }
    }
}

void EdmcFeature::openGenre(const QVariantMap& row) {
    m_screen = Screen::Releases;
    m_message = tr("Loading %1").arg(row.value(QStringLiteral("name")).toString());
    render();
    request(QStringLiteral("action:Browse"),
            HttpMethod::Post,
            QStringLiteral("/v1/browse"),
            {{QStringLiteral("genreUrl"), row.value(QStringLiteral("url")).toString()},
                    {QStringLiteral("genreName"), row.value(QStringLiteral("name")).toString()},
                    {QStringLiteral("page"), 1}});
}

void EdmcFeature::openFormats(qint64 topicId) {
    m_selectedTopicId = topicId;
    m_formatsParentScreen = m_screen;
    m_screen = Screen::Formats;
    const QJsonObject release = releaseForTopic(topicId);
    if (release.value(QStringLiteral("providers")).toArray().isEmpty()) {
        m_message = tr("Finding uploaded file options...");
        request(QStringLiteral("action:Resolve"),
                HttpMethod::Post,
                QStringLiteral("/v1/resolve"),
                {{QStringLiteral("topicId"), topicId}});
    } else {
        m_message.clear();
    }
    render();
}

void EdmcFeature::back() {
    if (m_screen == Screen::Formats) {
        m_screen = m_formatsParentScreen;
        m_selectedTopicId = 0;
    } else if (m_screen == Screen::Releases) {
        m_screen = Screen::Genres;
    } else if (m_screen == Screen::SearchResults) {
        m_screen = Screen::Categories;
    } else if (m_screen == Screen::Genres) {
        m_screen = Screen::Categories;
        m_selectedCategory = -1;
    }
    m_message.clear();
    render();
}

void EdmcFeature::searchMusic(const QString& query) {
    const QString normalized = query.simplified();
    if (normalized.size() < 2) {
        m_message = tr("Enter at least two characters to search EDMC Music");
        render();
        return;
    }
    m_screen = Screen::SearchResults;
    m_browse = {{QStringLiteral("mode"), QStringLiteral("search")},
            {QStringLiteral("query"), normalized},
            {QStringLiteral("releases"), QJsonArray{}}};
    m_message = tr("Searching EDMC Music for %1").arg(normalized);
    render();
    request(QStringLiteral("action:Search"),
            HttpMethod::Post,
            QStringLiteral("/v1/search"),
            {{QStringLiteral("query"), normalized}});
}

qint64 EdmcFeature::selectedTopicId() const {
    return m_pView ? m_pView->selectedRow().value(QStringLiteral("topicId")).toLongLong() : 0;
}

void EdmcFeature::downloadSelected() {
    activateSelected();
}

void EdmcFeature::previewSelected() {
    if (m_pPreviewPlayControl->get() > 0.0) {
        m_pPreviewStopControl->set(1.0);
        m_message = tr("Preview stopped");
        render();
        return;
    }
    loadDownloadedTrack(selectedTopicId(), QStringLiteral("[PreviewDeck1]"), true);
}

void EdmcFeature::loadSelectedDeck1() {
    loadDownloadedTrack(selectedTopicId(), QStringLiteral("[Channel1]"), false);
}

void EdmcFeature::loadSelectedDeck2() {
    loadDownloadedTrack(selectedTopicId(), QStringLiteral("[Channel2]"), false);
}

bool EdmcFeature::isViewActive() const {
    return m_pView && m_pView->isVisible();
}

QJsonObject EdmcFeature::releaseForTopic(qint64 topicId) const {
    for (const QJsonValue& value : m_browse.value(QStringLiteral("releases")).toArray()) {
        const QJsonObject release = value.toObject();
        if (release.value(QStringLiteral("topicId")).toVariant().toLongLong() == topicId) {
            return release;
        }
    }
    return {};
}

void EdmcFeature::loadDownloadedTrack(
        qint64 topicId, const QString& group, bool play) {
    if (!topicId) {
        return;
    }
    const QJsonObject release = releaseForTopic(topicId);
    const QJsonObject download = release.value(QStringLiteral("download")).toObject();
    const QString relativePath = download.value(QStringLiteral("relativePath")).toString();
    const QString usbRoot = m_status.value(QStringLiteral("storage"))
                                    .toObject()
                                    .value(QStringLiteral("usbRoot"))
                                    .toString();
    if (relativePath.isEmpty() || usbRoot.isEmpty()) {
        m_message = tr("Download this release before loading it");
        render();
        return;
    }
    const QString absolutePath = fileOnSelectedUsb(usbRoot, relativePath);
    if (absolutePath.isEmpty()) {
        m_message = tr("Downloaded track path is invalid");
        render();
        return;
    }
    if (!QFileInfo::exists(absolutePath)) {
        m_message = tr("Downloaded file is missing from the USB: %1").arg(absolutePath);
        render();
        return;
    }
    TrackPointer pTrack = m_pLibrary->trackCollectionManager()->getOrAddTrack(
            TrackRef::fromFilePath(absolutePath));
    if (!pTrack) {
        m_message = tr("BiteDJ could not add that downloaded track");
        render();
        return;
    }
    emit loadTrackToPlayer(pTrack, group, play);
    m_message = play ? tr("Previewing %1").arg(release.value(QStringLiteral("title")).toString())
                     : tr("Loaded %1").arg(release.value(QStringLiteral("title")).toString());
    render();
}

bool EdmcFeature::hasActiveJobs() const {
    for (const QJsonValue& value : m_jobs) {
        const QString state = value.toObject().value(QStringLiteral("state")).toString();
        if (state == QStringLiteral("queued") || state == QStringLiteral("running")) {
            return true;
        }
    }
    return false;
}

void EdmcFeature::render() {
    if (!m_pView) {
        return;
    }
    const QJsonObject auth = m_status.value(QStringLiteral("auth")).toObject();
    const QJsonObject storage = m_status.value(QStringLiteral("storage")).toObject();
    const QJsonObject settings = m_status.value(QStringLiteral("settings")).toObject();
    const QString usbRoot = storage.value(QStringLiteral("usbRoot")).toString();
    const QString downloadFolder = settings.value(QStringLiteral("downloadFolder")).toString();

    const QString statusText = tr("%1   |   USB: %2   |   Save: %3")
                                       .arg(auth.value(QStringLiteral("message")).toString(),
                                               usbRoot.isEmpty() ? tr("not selected") : usbRoot,
                                               downloadFolder.isEmpty() ? tr("not set") : downloadFolder);
    QString title = tr("EDMC  /  Music");
    QList<QVariantMap> rows;

    if (m_screen == Screen::Categories) {
        if (m_catalog.isEmpty()) {
            rows.append({{QStringLiteral("key"), QStringLiteral("catalog-refresh")},
                    {QStringLiteral("action"), QStringLiteral("catalog-refresh")},
                    {QStringLiteral("label"), tr("Fetch music genres")}});
        } else {
            for (int index = 0; index < m_catalog.size(); ++index) {
                const QJsonObject category = m_catalog.at(index).toObject();
                rows.append({{QStringLiteral("key"), QStringLiteral("category:%1").arg(index)},
                        {QStringLiteral("action"), QStringLiteral("category")},
                        {QStringLiteral("index"), index},
                        {QStringLiteral("label"), QStringLiteral("%1   >").arg(category.value(QStringLiteral("name")).toString())}});
            }
        }
    } else if (m_screen == Screen::Genres && m_selectedCategory >= 0 &&
            m_selectedCategory < m_catalog.size()) {
        const QJsonObject category = m_catalog.at(m_selectedCategory).toObject();
        title += QStringLiteral("  /  %1").arg(category.value(QStringLiteral("name")).toString());
        for (const QJsonValue& value : category.value(QStringLiteral("genres")).toArray()) {
            const QJsonObject genre = value.toObject();
            const QString name = genre.value(QStringLiteral("name")).toString();
            const QString url = genre.value(QStringLiteral("url")).toString();
            rows.append({{QStringLiteral("key"), QStringLiteral("genre:%1").arg(url)},
                    {QStringLiteral("action"), QStringLiteral("genre")},
                    {QStringLiteral("name"), name},
                    {QStringLiteral("url"), url},
                    {QStringLiteral("label"), QStringLiteral("%1   >").arg(name)}});
        }
    } else if (m_screen == Screen::Releases ||
            m_screen == Screen::SearchResults) {
        const int currentPage = m_browse.value(QStringLiteral("page")).toInt(1);
        const int lastPage = m_browse.value(QStringLiteral("lastPage")).toInt(1);
        if (m_screen == Screen::SearchResults) {
            title += QStringLiteral("  /  Search: %1")
                             .arg(m_browse.value(QStringLiteral("query")).toString());
        } else {
            title += QStringLiteral("  /  %1  /  Page %2 of %3")
                             .arg(m_browse.value(QStringLiteral("genreName")).toString())
                             .arg(currentPage)
                             .arg(lastPage);
        }
        if (m_screen == Screen::Releases &&
                m_browse.value(QStringLiteral("hasPrevious")).toBool()) {
            rows.append({{QStringLiteral("key"), QStringLiteral("page:%1").arg(currentPage - 1)},
                    {QStringLiteral("action"), QStringLiteral("page")},
                    {QStringLiteral("page"), currentPage - 1},
                    {QStringLiteral("label"), tr("<   Previous page")}});
        }
        for (const QJsonValue& value : m_browse.value(QStringLiteral("releases")).toArray()) {
            const QJsonObject release = value.toObject();
            const qint64 topicId = release.value(QStringLiteral("topicId")).toVariant().toLongLong();
            const bool downloaded = !release.value(QStringLiteral("download")).toObject().isEmpty();
            QString jobState;
            QString jobMessage;
            for (const QJsonValue& jobValue : m_jobs) {
                const QJsonObject job = jobValue.toObject();
                if (job.value(QStringLiteral("kind")).toString() == QStringLiteral("download") &&
                        job.value(QStringLiteral("details"))
                                        .toObject()
                                        .value(QStringLiteral("topicId"))
                                        .toVariant()
                                        .toLongLong() == topicId) {
                    jobState = job.value(QStringLiteral("state")).toString();
                    jobMessage = job.value(QStringLiteral("message")).toString();
                    if (jobState == QStringLiteral("failed")) {
                        jobMessage = job.value(QStringLiteral("error")).toString();
                    }
                    break;
                }
            }
            const bool busy = jobState == QStringLiteral("queued") ||
                    jobState == QStringLiteral("running");
            QString prefix;
            if (downloaded) {
                prefix = QStringLiteral("[USB]  ");
            } else if (jobState == QStringLiteral("running")) {
                prefix = QStringLiteral("[DOWNLOADING: %1]  ").arg(jobMessage);
            } else if (jobState == QStringLiteral("queued")) {
                prefix = QStringLiteral("[QUEUED]  ");
            } else if (jobState == QStringLiteral("failed")) {
                prefix = QStringLiteral("[FAILED: %1]  ").arg(jobMessage);
            }
            const QString sourceName = release.value(QStringLiteral("subscriptionName"))
                                               .toString()
                                               .isEmpty()
                    ? release.value(QStringLiteral("genreName")).toString()
                    : release.value(QStringLiteral("subscriptionName")).toString();
            rows.append({{QStringLiteral("key"), QStringLiteral("release:%1").arg(topicId)},
                    {QStringLiteral("action"), QStringLiteral("release")},
                    {QStringLiteral("topicId"), topicId},
                    {QStringLiteral("downloaded"), downloaded},
                    {QStringLiteral("busy"), busy},
                    {QStringLiteral("label"), QStringLiteral("%1%2   |   %3")
                                                         .arg(prefix,
                                                         release.value(QStringLiteral("title")).toString(),
                                                                 sourceName)}});
        }
        if (m_screen == Screen::Releases &&
                m_browse.value(QStringLiteral("hasNext")).toBool()) {
            rows.append({{QStringLiteral("key"), QStringLiteral("page:%1").arg(currentPage + 1)},
                    {QStringLiteral("action"), QStringLiteral("page")},
                    {QStringLiteral("page"), currentPage + 1},
                    {QStringLiteral("label"), tr("Next page   >")}});
        }
    } else if (m_screen == Screen::Formats) {
        const QJsonObject release = releaseForTopic(m_selectedTopicId);
        title += QStringLiteral("  /  %1  /  Choose file")
                         .arg(release.value(QStringLiteral("title")).toString());
        const QJsonArray providers = release.value(QStringLiteral("providers")).toArray();
        if (providers.isEmpty()) {
            rows.append({{QStringLiteral("key"), QStringLiteral("resolving")},
                    {QStringLiteral("action"), QStringLiteral("waiting")},
                    {QStringLiteral("label"), tr("Finding the files uploaded with this post...")}});
        } else {
            for (int index = 0; index < providers.size(); ++index) {
                const QJsonObject provider = providers.at(index).toObject();
                const QString providerId = provider.value(QStringLiteral("providerId")).toString();
                QString label = provider.value(QStringLiteral("label")).toString().trimmed();
                const QString hintedFormat = provider.value(QStringLiteral("hintedFormat")).toString();
                if (label.isEmpty() || label.startsWith(QStringLiteral("File option"))) {
                    label = hintedFormat.isEmpty()
                            ? tr("File option %1 (format verified after download)").arg(index + 1)
                            : hintedFormat.toUpper();
                }
                rows.append({{QStringLiteral("key"), QStringLiteral("provider:%1").arg(providerId)},
                        {QStringLiteral("action"), QStringLiteral("provider")},
                        {QStringLiteral("topicId"), m_selectedTopicId},
                        {QStringLiteral("providerId"), providerId},
                        {QStringLiteral("label"), QStringLiteral("%1   |   DOWNLOAD").arg(label)}});
            }
        }
    }

    m_pView->setHeader(title, statusText, m_message, hasActiveJobs());
    m_pView->setRows(rows);
    m_pView->setBackEnabled(m_screen != Screen::Categories);
    m_pView->setPreviewActive(m_pPreviewPlayControl->get() > 0.0);
}
