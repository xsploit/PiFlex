#include "library/mixxxlibraryfeature.h"

#include <QtDebug>
#include <QSqlQuery>
#ifdef __ENGINEPRIME__
#include <QMenu>
#endif

#include "library/basetrackcache.h"
#include "library/dao/trackschema.h"
#include "library/library.h"
#include "library/librarytablemodel.h"
#include "library/missing_hidden/dlghidden.h"
#include "library/missing_hidden/dlgmissing.h"
#include "library/parser.h"
#include "library/queryutil.h"
#include "library/rekordbox/rekordboxfeature.h"
#include "library/trackcollection.h"
#include "library/trackcollectionmanager.h"
#include "library/treeitem.h"
#include "moc_mixxxlibraryfeature.cpp"
#include "sources/soundsourceproxy.h"
#include "widget/wlibrary.h"
#ifdef __ENGINEPRIME__
#include "widget/wlibrarysidebar.h"
#endif


MixxxLibraryFeature::MixxxLibraryFeature(Library* pLibrary,
        UserSettingsPointer pConfig)
        : LibraryFeature(pLibrary, pConfig, QStringLiteral("tracks")),
          kMissingTitle(tr("Missing Tracks")),
          kHiddenTitle(tr("Hidden Tracks")),
          m_pTrackCollection(pLibrary->trackCollectionManager()->internalCollection()),
          m_pLibraryTableModel(nullptr),
          m_pSidebarModel(make_parented<TreeItemModel>(this)),
          m_pMissingView(nullptr),
          m_pHiddenView(nullptr) {
    QString idColumn = LIBRARYTABLE_ID;
    QStringList columns = {
            LIBRARYTABLE_ID,
            LIBRARYTABLE_PLAYED,
            LIBRARYTABLE_TIMESPLAYED,
            LIBRARYTABLE_LAST_PLAYED_AT,
            // has to be up here otherwise Played and TimesPlayed are not shown
            LIBRARYTABLE_ALBUMARTIST,
            LIBRARYTABLE_ALBUM,
            LIBRARYTABLE_ARTIST,
            LIBRARYTABLE_TITLE,
            LIBRARYTABLE_YEAR,
            LIBRARYTABLE_RATING,
            LIBRARYTABLE_GENRE,
            LIBRARYTABLE_COMPOSER,
            LIBRARYTABLE_GROUPING,
            LIBRARYTABLE_TRACKNUMBER,
            LIBRARYTABLE_KEY,
            LIBRARYTABLE_KEY_ID,
            LIBRARYTABLE_BPM,
            LIBRARYTABLE_BPM_LOCK,
            LIBRARYTABLE_DURATION,
            LIBRARYTABLE_BITRATE,
            LIBRARYTABLE_REPLAYGAIN,
            LIBRARYTABLE_FILETYPE,
            LIBRARYTABLE_DATETIMEADDED,
            TRACKLOCATIONSTABLE_LOCATION,
            TRACKLOCATIONSTABLE_FSDELETED,
            LIBRARYTABLE_COMMENT,
            LIBRARYTABLE_MIXXXDELETED,
            LIBRARYTABLE_COLOR,
            LIBRARYTABLE_COVERART_SOURCE,
            LIBRARYTABLE_COVERART_TYPE,
            LIBRARYTABLE_COVERART_LOCATION,
            LIBRARYTABLE_COVERART_COLOR,
            LIBRARYTABLE_COVERART_DIGEST,
            LIBRARYTABLE_COVERART_HASH};
    QStringList searchColumns = {
            LIBRARYTABLE_ARTIST,
            LIBRARYTABLE_ALBUM,
            LIBRARYTABLE_ALBUMARTIST,
            TRACKLOCATIONSTABLE_LOCATION,
            LIBRARYTABLE_GROUPING,
            LIBRARYTABLE_COMMENT,
            LIBRARYTABLE_TITLE,
            LIBRARYTABLE_GENRE,
            LIBRARYTABLE_CRATE};

    QStringList qualifiedTableColumns;
    for (const auto& col : columns) {
        qualifiedTableColumns.append(mixxx::trackschema::tableForColumn(col) +
                QLatin1Char('.') + col);
    }

    QSqlQuery query(m_pTrackCollection->database());
    QString tableName = "library_cache_view";
    QString queryString = QString(
            "CREATE TEMPORARY VIEW IF NOT EXISTS %1 AS "
            "SELECT %2 FROM library "
            "INNER JOIN track_locations ON library.location = track_locations.id")
                                  .arg(tableName, qualifiedTableColumns.join(","));
    query.prepare(queryString);
    if (!query.exec()) {
        LOG_FAILED_QUERY(query);
    }

    BaseTrackCache* pBaseTrackCache = new BaseTrackCache(m_pTrackCollection,
            std::move(tableName),
            std::move(idColumn),
            std::move(columns),
            std::move(searchColumns),
            true);
    m_pBaseTrackCache = QSharedPointer<BaseTrackCache>(pBaseTrackCache);
    m_pTrackCollection->connectTrackSource(m_pBaseTrackCache);

    // These rely on the 'default' track source being present.
    m_pLibraryTableModel = new LibraryTableModel(this,
            pLibrary->trackCollectionManager(),
            "mixxx.db.model.library");

    std::unique_ptr<TreeItem> pRootItem = TreeItem::newRoot(this);
    pRootItem->appendChild(kMissingTitle);
    pRootItem->appendChild(kHiddenTitle);

    m_pSidebarModel->setRootItem(std::move(pRootItem));

#ifdef __ENGINEPRIME__
    m_pExportLibraryAction = make_parented<QAction>(tr("Export to Engine DJ"), this);
    connect(m_pExportLibraryAction.get(),
            &QAction::triggered,
            this,
            &MixxxLibraryFeature::exportLibrary);
#endif
}

void MixxxLibraryFeature::bindLibraryWidget(WLibrary* pLibraryWidget,
                                     KeyboardEventFilter* pKeyboard) {
    m_pHiddenView = new DlgHidden(pLibraryWidget, m_pConfig, m_pLibrary,
                                  pKeyboard);
    pLibraryWidget->registerView(kHiddenTitle, m_pHiddenView);
    connect(m_pHiddenView,
            &DlgHidden::trackSelected,
            this,
            &MixxxLibraryFeature::trackSelected);

    m_pMissingView = new DlgMissing(pLibraryWidget, m_pConfig, m_pLibrary,
                                    pKeyboard);
    pLibraryWidget->registerView(kMissingTitle, m_pMissingView);
    connect(m_pMissingView,
            &DlgMissing::trackSelected,
            this,
            &MixxxLibraryFeature::trackSelected);
}

QVariant MixxxLibraryFeature::title() {
    // BiteDJ previously hid this feature, leaving tracks learned from normal
    // USB browsing and EDMC downloads without an obvious common destination.
    // "All Tracks" is the controller-style name for Mixxx's internal
    // collection. Rekordbox devices retain their own complete All Tracks child
    // for files that have not yet been opened by BiteDJ.
    return tr("All Tracks");
}

TreeItemModel* MixxxLibraryFeature::sidebarModel() const {
    return m_pSidebarModel;
}

void MixxxLibraryFeature::refreshLibraryModels() {
    if (m_pLibraryTableModel) {
        m_pLibraryTableModel->select();
    }
    if (m_pMissingView) {
        m_pMissingView->onShow();
    }
    if (m_pHiddenView) {
        m_pHiddenView->onShow();
    }
}

bool MixxxLibraryFeature::ensureAllTracksModel() {
    static const QString kLibraryView = QStringLiteral("bitedj_all_tracks_library");
    static const QString kPlaylistsView = QStringLiteral("bitedj_all_tracks_playlists");
    static const QString kPlaylistTracksView =
            QStringLiteral("bitedj_all_tracks_playlist_tracks");

    QSqlDatabase database = m_pTrackCollection->database();
    QSqlQuery query(database);
    const QStringList statements = {
            QStringLiteral(
                    "CREATE TEMPORARY VIEW IF NOT EXISTS %1 AS "
                    "SELECT 1000000000 + id AS id, artist, title, album, year, "
                    "genre, tracknumber, location, comment, rating, duration, "
                    "bitrate, bpm, key, color, analyze_path FROM rekordbox_library "
                    "UNION ALL "
                    "SELECT library.id AS id, library.artist, library.title, "
                    "library.album, library.year, library.genre, "
                    "library.tracknumber, track_locations.location, "
                    "library.comment, library.rating, library.duration, "
                    "library.bitrate, library.bpm, library.key, library.color, "
                    "'' AS analyze_path FROM library "
                    "INNER JOIN track_locations ON library.location = track_locations.id "
                    "WHERE library.mixxx_deleted = 0 AND track_locations.fs_deleted = 0 "
                    "AND NOT EXISTS (SELECT 1 FROM rekordbox_library rb "
                    "WHERE rb.location = track_locations.location)")
                    .arg(kLibraryView),
            QStringLiteral(
                    "CREATE TEMPORARY VIEW IF NOT EXISTS %1 AS "
                    "SELECT 1 AS id, 'All Tracks' AS name")
                    .arg(kPlaylistsView),
            QStringLiteral(
                    "CREATE TEMPORARY VIEW IF NOT EXISTS %1 AS "
                    "SELECT 1 AS playlist_id, id AS track_id, id AS position FROM %2")
                    .arg(kPlaylistTracksView, kLibraryView)};
    for (const QString& statement : statements) {
        if (!query.exec(statement)) {
            LOG_FAILED_QUERY(query) << "Unable to create the PiFlex All Tracks view";
            return false;
        }
    }

    if (!m_pAllTracksCache) {
        const QStringList columns = {
                LIBRARYTABLE_ID,
                LIBRARYTABLE_ARTIST,
                LIBRARYTABLE_TITLE,
                LIBRARYTABLE_ALBUM,
                LIBRARYTABLE_YEAR,
                LIBRARYTABLE_GENRE,
                LIBRARYTABLE_TRACKNUMBER,
                TRACKLOCATIONSTABLE_LOCATION,
                LIBRARYTABLE_COMMENT,
                LIBRARYTABLE_RATING,
                LIBRARYTABLE_DURATION,
                LIBRARYTABLE_BITRATE,
                LIBRARYTABLE_BPM,
                LIBRARYTABLE_KEY,
                LIBRARYTABLE_COLOR,
                REKORDBOX_ANALYZE_PATH};
        const QStringList searchColumns = {
                LIBRARYTABLE_ARTIST,
                LIBRARYTABLE_TITLE,
                LIBRARYTABLE_ALBUM,
                LIBRARYTABLE_GENRE,
                LIBRARYTABLE_TRACKNUMBER,
                TRACKLOCATIONSTABLE_LOCATION,
                LIBRARYTABLE_COMMENT};
        m_pAllTracksCache = QSharedPointer<BaseTrackCache>::create(
                m_pTrackCollection,
                kLibraryView,
                LIBRARYTABLE_ID,
                columns,
                searchColumns,
                false);
        m_pAllTracksModel = new RekordboxPlaylistModel(this,
                m_pLibrary->trackCollectionManager(),
                "mixxx.db.model.bitedj.alltracks",
                kPlaylistsView,
                kPlaylistTracksView,
                m_pAllTracksCache);
        m_pAllTracksModel->setPlaylistById(1);
    }
    m_pAllTracksCache->buildIndex();
    m_pAllTracksModel->select();
    return true;
}

void MixxxLibraryFeature::searchAndActivate(const QString& query) {
    if (ensureAllTracksModel()) {
        m_pAllTracksModel->search(query);
    } else {
        VERIFY_OR_DEBUG_ASSERT(m_pLibraryTableModel) {
            return;
        }
        m_pLibraryTableModel->search(query);
    }
    activate();
}

#ifdef __ENGINEPRIME__
void MixxxLibraryFeature::bindSidebarWidget(WLibrarySidebar* pSidebarWidget) {
    // store the sidebar widget pointer for later use in onRightClick
    m_pSidebarWidget = pSidebarWidget;
}
#endif

void MixxxLibraryFeature::activate() {
    emit saveModelState();
    if (ensureAllTracksModel()) {
        emit showTrackModel(m_pAllTracksModel);
    } else {
        emit showTrackModel(m_pLibraryTableModel);
    }
    emit enableCoverArtDisplay(true);
}

void MixxxLibraryFeature::activateChild(const QModelIndex& index) {
    QString itemName = index.data().toString();
    emit saveModelState();
    emit switchToView(itemName);
    if (m_pMissingView && itemName == kMissingTitle) {
        emit restoreSearch(m_pMissingView->currentSearch());
    } else if (m_pHiddenView && itemName == kHiddenTitle) {
        emit restoreSearch(m_pHiddenView->currentSearch());
    }
    emit enableCoverArtDisplay(true);
}

bool MixxxLibraryFeature::dropAccept(const QList<QUrl>& urls, QObject* pSource) {
    if (pSource) {
        return false;
    } else {
        QList<TrackId> trackIds = m_pLibrary->trackCollectionManager()->resolveTrackIdsFromUrls(
                urls, true);
        return trackIds.size() > 0;
    }
}

bool MixxxLibraryFeature::dragMoveAccept(const QUrl& url) {
    return SoundSourceProxy::isUrlSupported(url) ||
            Parser::isPlaylistFilenameSupported(url.toLocalFile());
}

#ifdef __ENGINEPRIME__
void MixxxLibraryFeature::onRightClick(const QPoint& globalPos) {
    QMenu menu(m_pSidebarWidget);
    menu.addAction(m_pExportLibraryAction.get());
    menu.exec(globalPos);
}
#endif
