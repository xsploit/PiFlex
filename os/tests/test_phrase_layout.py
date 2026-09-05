"""Prevent the phrase row from being placed inside the clipped waveform."""
from pathlib import Path
import xml.etree.ElementTree as ET

root=Path(__file__).resolve().parents[2]
deck=ET.parse(root/'res/skins/BiteDJ/deck.xml').getroot()
def named(name):
    return next(node for node in deck.iter() if node.findtext('ObjectName')==name)
container=named('DeckOverviewContainer')
clip=named('DeckWaveformClip')
phrase=named('DeckPhraseOverview')
assert container.findtext('Size')=='0me,98f'
assert clip.findtext('Size')=='0me,80f'
assert named('DeckOverview').findtext('Size')=='0me,160f'
children=container.find('Children')
assert list(children)==[clip,phrase]
assert phrase.tag=='PhraseOverview' and phrase.findtext('Size')=='0me,18f'
assert not list(clip.iter('PhraseOverview'))
assert 'paintPhraseStrip' not in (root/'src/widget/woverview.cpp').read_text()
print('Separate 18px phrase row, 80px waveform clip and 160px source preserved.')
