"""Read-only settings evidence from the exact Rekordbox 6.7.0.0072 image.

Usage: uv run --with pefile --with capstone python THIS_FILE rekordbox.exe
Raw values are not assumed to be user-facing units or portable enum values.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from extract_rekordbox67_pad_defaults import EXPECTED_SHA256

SETTINGS = (
    ('DeckLoadLock', 0x141ef7710, 0x141ef9b48, '<i', 1, 0x140988790),
    ('DeckNeedleLock', 0x141ef7790, 0x141ef9b55, '<B', 1, 0x140988ac0),
    ('AutoCueLeveldB', 0x141ef77a0, 0x141ef9b5c, '<i', 5, 0x140985810),
    ('DeckQuantizeMode', 0x141ef7820, 0x141ef9b74, '<i', 2, 0x14098ac50),
)


def extract(path):
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != EXPECTED_SHA256:
        raise ValueError('Unsupported executable hash')
    pe = pefile.PE(data=raw)
    base = pe.OPTIONAL_HEADER.ImageBase
    result = []
    for name, key_address, value_address, fmt, expected, getter in SETTINGS:
        key = pe.get_data(key_address-base, len(name)+1)
        value = struct.unpack(fmt, pe.get_data(value_address-base, struct.calcsize(fmt)))[0]
        if key != name.encode('ascii') + b'\0' or value != expected:
            raise AssertionError(f'Unexpected settings evidence for {name}')
        result.append({'key': name, 'raw_default': value,
                       'getter_va': hex(getter), 'default_va': hex(value_address),
                       'status': 'key, getter and missing-setting default traced; ' +
                                 ('UI choices mapped below' if name == 'DeckLoadLock' else 'UI enum semantics incomplete')})
    decoder = Cs(CS_ARCH_X86, CS_MODE_64)
    for address, mnemonic, operand in (
            (0x140988836, 'cmp', 'ebx, 3'),
            (0x140988848, 'mov', 'edx, 2'),
            (0x140988878, 'mov', 'eax, 2'),
            # UI label initializers -> ordered radio choices -> selection branch.
            (0x1400a2bd4, 'lea', 'rdx, [rip + 0x1daab25]'),
            (0x1400a5154, 'lea', 'rdx, [rip + 0x1da85ad]'),
            (0x14090b283, 'lea', 'rdx, [rip + 0x39ad68e]'),
            (0x14090b293, 'lea', 'rdx, [rip + 0x39ad3ae]'),
            (0x14090b415, 'cmp', 'r13, 2'),
            (0x14090b41b, 'test', 'edi, edi'),
            (0x14090b41f, 'cmp', 'r13, 1'),
            (0x14090b425, 'cmp', 'edi, r13d')):
        ins = next(decoder.disasm(pe.get_data(address-base, 15), address))
        if (ins.mnemonic, ins.op_str) != (mnemonic, operand):
            raise AssertionError(f'Unexpected load-lock migration instruction at {address:#x}')
    for address, label in ((0x141e4d700, b'Lock\0'), (0x141e4d708, b'Unlock\0')):
        if pe.get_data(address-base, len(label)) != label:
            raise AssertionError('Unexpected load-lock UI label')
    return {'version': '6.7.0.0072', 'sha256': EXPECTED_SHA256,
            'settings': result,
            'migration': {'DeckLoadLock': {'stored_value': 3, 'replacement_value': 2,
                                         'note': 'getter writes replacement and returns 2 (Lock)'}},
            'ui_choices': {'DeckLoadLock': {'1': 'Unlock', '2': 'Lock',
                           'evidence': 'label initializers 1400a2bd0/1400a5150; radio selection in 14090aff0',
                           'limit': 'downstream deck-state predicates are not fully named; no fader-down equivalence claimed'}},
            'warning': 'AutoCueLeveldB raw default 5 is not evidence of a +5 dB threshold. Do not directly import these values into BiteDJ.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable', type=Path)
    print(json.dumps(extract(parser.parse_args().executable), indent=2))
