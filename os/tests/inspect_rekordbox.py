"""Read-only audit of a private Rekordbox metadata snapshot using our real parsers.

Linux/Qt6 build dependencies required. Usage: inspect_rekordbox.py SNAPSHOT REPORT
SNAPSHOT contains PIONEER/rekordbox/export.pdb and PIONEER/USBANLZ. No audio is
copied or played. REPORT includes private library paths; keep it outside Git.
"""
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
from native_test_support import fpclassify_object

ROOT = Path(__file__).resolve().parents[2]
def extract(signature):
    text = (ROOT/'src/library/rekordbox/rekordboxfeature.cpp').read_text()
    start = text.index(signature); body = text.index('{', start)
    depth = 1; cursor = body+1
    while depth:
        if text[cursor] == '{': depth += 1
        if text[cursor] == '}': depth -= 1
        cursor += 1
    return text[start:cursor]

source = r'''
#include <QDirIterator>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTextCodec>
#include <fstream>
#include <iostream>
#include <rekordbox_pdb.h>
#include <rekordbox_anlz.h>
#include "library/rekordbox/rekordboxpagechain.h"
#include "library/rekordbox/rekordboxwaveform.h"
#include "library/rekordbox/rekordboxphrases.h"
template<typename Base, typename T> bool instanceof(const T* ptr) {
    return dynamic_cast<const Base*>(ptr) != nullptr;
}
'''+extract('QString fromUtf16LeString(')+extract('QString getText(')+r'''
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    const QString root = QString::fromLocal8Bit(argv[1]);
    QJsonObject result;
    QJsonArray tracks, playlists, entries, tables, analyses;
    try {
        std::ifstream file((root+"/PIONEER/rekordbox/export.pdb").toStdString(),std::ios::binary);
        kaitai::kstream stream(&file);
        rekordbox_pdb_t db(&stream);
        result["pageSize"] = int(db.len_page());
        for (auto* table : *db.tables()) {
            // Match the tables used by the application; other formats have
            // row layouts this reader intentionally does not interpret.
            auto type = table->type();
            if (type != rekordbox_pdb_t::PAGE_TYPE_TRACKS &&
                type != rekordbox_pdb_t::PAGE_TYPE_KEYS &&
                type != rekordbox_pdb_t::PAGE_TYPE_GENRES &&
                type != rekordbox_pdb_t::PAGE_TYPE_ARTISTS &&
                type != rekordbox_pdb_t::PAGE_TYPE_ALBUMS &&
                type != rekordbox_pdb_t::PAGE_TYPE_PLAYLIST_TREE &&
                type != rekordbox_pdb_t::PAGE_TYPE_PLAYLIST_ENTRIES &&
                type != rekordbox_pdb_t::PAGE_TYPE_HISTORY) continue;
            mixxx::rekordbox::PageChainGuard guard(db.len_page(),stream.size());
            auto* ref = table->first_page();
            int pages=0,rows=0;
            while (true) {
                guard.visit(ref->index());
                auto* page = ref->body(); ++pages;
                if (page->is_data_page()) {
                    for (auto* group : *page->row_groups()) {
                        for (auto* row : *group->rows()) {
                            if (!row->present()) continue;
                            ++rows;
                            auto* body=row->body();
                            if (type == rekordbox_pdb_t::PAGE_TYPE_TRACKS) {
                                auto* track=static_cast<rekordbox_pdb_t::track_row_t*>(body);
                                tracks.append(QJsonObject{{"id",qint64(track->id())},
                                    {"title",getText(track->title())},
                                    {"file",getText(track->file_path())},
                                    {"analysis",getText(track->analyze_path())}});
                            } else if (type == rekordbox_pdb_t::PAGE_TYPE_PLAYLIST_TREE) {
                                auto* playlist=static_cast<rekordbox_pdb_t::playlist_tree_row_t*>(body);
                                playlists.append(QJsonObject{{"id",qint64(playlist->id())},
                                    {"parent",qint64(playlist->parent_id())},
                                    {"name",getText(playlist->name())},
                                    {"folder",bool(playlist->is_folder())}});
                            } else if (type == rekordbox_pdb_t::PAGE_TYPE_PLAYLIST_ENTRIES) {
                                auto* entry=static_cast<rekordbox_pdb_t::playlist_entry_row_t*>(body);
                                entries.append(QJsonObject{{"playlist",qint64(entry->playlist_id())},
                                    {"track",qint64(entry->track_id())},
                                    {"position",qint64(entry->entry_index())}});
                            }
                        }
                    }
                }
                if (ref->index() == table->last_page()->index()) break;
                ref=page->next_page();
            }
            tables.append(QJsonObject{{"type",int(type)},{"pages",pages},{"rows",rows}});
        }
    } catch (const std::exception& error) {
        result["databaseError"] = QString::fromUtf8(error.what());
    }
    QDirIterator files(root+"/PIONEER/USBANLZ",QDir::Files,QDirIterator::Subdirectories);
    while (files.hasNext()) {
        QString path=files.next();
        QJsonObject item{{"path",QDir(root).relativeFilePath(path)},
                        {"bytes",QFileInfo(path).size()}};
        try {
            std::ifstream file(path.toStdString(),std::ios::binary);
            kaitai::kstream stream(&file);
            rekordbox_anlz_t analysis(&stream);
            QJsonArray tags;
            int beats=0,hot=0,memory=0,loops=0;
            int decodedThreeBandColumns=0;
            int decodedPhrases=0;
            for (const auto& section : *analysis.sections()) {
                tags.append(qint64(section->fourcc()));
                if (section->fourcc()==rekordbox_anlz_t::SECTION_TAGS_SONG_STRUCTURE) {
                    const QString datPath=path.left(path.length()-3)+"DAT";
                    std::ifstream datFile(datPath.toStdString(),std::ios::binary);
                    kaitai::kstream datStream(&datFile);
                    rekordbox_anlz_t dat(&datStream);
                    std::vector<double> times;
                    double finalBoundary=std::numeric_limits<double>::quiet_NaN();
                    for (const auto& datSection : *dat.sections()) {
                        if (datSection->fourcc()==rekordbox_anlz_t::SECTION_TAGS_BEAT_GRID) {
                            auto* grid=static_cast<rekordbox_anlz_t::beat_grid_tag_t*>(datSection->body());
                            for (const auto& beat : *grid->beats()) {
                                times.push_back(beat->time());
                                finalBoundary=beat->tempo()>0?beat->time()+6000000.0/beat->tempo():
                                    std::numeric_limits<double>::quiet_NaN();
                            }
                        }
                    }
                    int ignoredFills=0;
                    const auto decoded=mixxx::rekordbox::decodePhrases(
                        *static_cast<rekordbox_anlz_t::song_structure_tag_t*>(section->body()),
                        times, times.empty()?0:times.back()/1000.0+60,0,finalBoundary,&ignoredFills);
                    item["ignoredPhraseFills"]=ignoredFills;
                    decodedPhrases+=decoded.size();
                }
                if (section->fourcc()==rekordbox_anlz_t::SECTION_TAGS_WAVE_3BAND_SCROLL) {
                    auto* wave=static_cast<rekordbox_anlz_t::wave_3band_scroll_tag_t*>(section->body());
                    if (wave->len_entry_bytes()!=3 || wave->entries().size()!=uint64_t(wave->len_entries())*3) {
                        throw std::runtime_error("Unexpected three-band layout");
                    }
                    const auto decoded=mixxx::rekordbox::decodeThreeBandWaveform(
                        wave->entries(),150,150,int(wave->len_entries()),0);
                    const auto bytes=wave->entries();
                    for (size_t i=0;i<bytes.size()/3;++i) {
                        const auto& column=decoded[i*2];
                        if (column.filtered.mid!=static_cast<unsigned char>(bytes[i*3]) ||
                            column.filtered.high!=static_cast<unsigned char>(bytes[i*3+1]) ||
                            column.filtered.low!=static_cast<unsigned char>(bytes[i*3+2]) ||
                            column.m_i!=decoded[i*2+1].m_i) {
                            throw std::runtime_error("Three-band column/channel mismatch");
                        }
                    }
                    decodedThreeBandColumns+=decoded.size()/2;
                }
                if (section->fourcc()==rekordbox_anlz_t::SECTION_TAGS_BEAT_GRID) {
                    beats+=static_cast<rekordbox_anlz_t::beat_grid_tag_t*>(section->body())->beats()->size();
                } else if (section->fourcc()==rekordbox_anlz_t::SECTION_TAGS_CUES) {
                    auto* tag=static_cast<rekordbox_anlz_t::cue_tag_t*>(section->body());
                    for (const auto& cue : *tag->cues()) {
                        if (cue->hot_cue()) ++hot; else ++memory;
                        if (int(cue->type())==2) ++loops;
                    }
                } else if (section->fourcc()==rekordbox_anlz_t::SECTION_TAGS_CUES_2) {
                    auto* tag=static_cast<rekordbox_anlz_t::cue_extended_tag_t*>(section->body());
                    for (const auto& cue : *tag->cues()) {
                        if (cue->hot_cue()) ++hot; else ++memory;
                        if (int(cue->type())==2) ++loops;
                    }
                }
            }
            item["tags"]=tags; item["beats"]=beats; item["hotCues"]=hot;
            item["memoryCues"]=memory; item["loops"]=loops;
            item["decodedThreeBandColumns"]=decodedThreeBandColumns;
            item["decodedPhrases"]=decodedPhrases;
        } catch (const std::exception& error) {
            item["error"]=QString::fromUtf8(error.what());
        }
        analyses.append(item);
    }
    result["tracks"]=tracks; result["playlists"]=playlists;
    result["entries"]=entries; result["tables"]=tables; result["analysis"]=analyses;
    std::cout << QJsonDocument(result).toJson().constData();
}
'''
with tempfile.TemporaryDirectory(prefix='pflx-rekordbox-audit-') as directory:
    cpp=Path(directory)/'audit.cpp'; cpp.write_text(source)
    binary=Path(directory)/'audit'
    flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','Qt6Core','Qt6Core5Compat'],text=True))
    # Match PiFlex's Kaitai target: strings remain raw until Qt decodes them.
    # ICONV here would decode twice and falsely report Unicode paths missing.
    assert 'target_compile_definitions(Kaitai PRIVATE KS_STR_ENCODING_NONE)' in (ROOT/'CMakeLists.txt').read_text()
    subprocess.run(['c++','-std=c++20','-fPIC','-O2','-ffast-math','-DKS_STR_ENCODING_NONE',
        '-I'+str(ROOT/'src'),'-I'+str(ROOT/'lib/rekordbox-metadata'),'-I'+str(ROOT/'lib/kaitai'),
        str(cpp),str(ROOT/'lib/rekordbox-metadata/rekordbox_pdb.cpp'),
        str(ROOT/'lib/rekordbox-metadata/rekordbox_anlz.cpp'),
        str(ROOT/'lib/kaitai/kaitai/kaitaistream.cpp'),fpclassify_object(directory),'-lz','-o',str(binary),*flags],check=True)
    result=subprocess.check_output([str(binary),sys.argv[1]],text=True,timeout=120)
    report=json.loads(result)
    Path(sys.argv[2]).write_text(result)
    print(json.dumps({'tracks':len(report['tracks']),'playlistsAndFolders':len(report['playlists']),
        'playlistEntries':len(report['entries']),'analysisFiles':len(report['analysis']),
        'analysisFailures':sum('error' in item for item in report['analysis']),
        'databaseError':report.get('databaseError')},indent=2))
