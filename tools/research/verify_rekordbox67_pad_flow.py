"""Verify selected static Pad FX findings against a local, hash-pinned EXE.

uv run --with pefile --with capstone python THIS_FILE /path/to/rekordbox.exe
No target execution, memory attachment, patching, or decompiled source export.
These checks corroborate documented branches; they are not an audio A/B test.
"""
import argparse
import hashlib
import json
import math
import struct
from pathlib import Path

import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from extract_rekordbox67_pad_defaults import EXPECTED_SHA256, extract


def verify(path):
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != EXPECTED_SHA256:
        raise ValueError('Unsupported executable; expected signed 6.7.0.0072 image hash')
    pe = pefile.PE(data=raw)
    base = pe.OPTIONAL_HEADER.ImageBase
    decoder = Cs(CS_ARCH_X86, CS_MODE_64)

    def instruction(address, mnemonic, operand):
        ins = next(decoder.disasm(pe.get_data(address-base, 15), address))
        if ins.mnemonic != mnemonic or ins.op_str != operand:
            raise AssertionError(f'{address:#x}: expected {mnemonic} {operand}, got {ins.mnemonic} {ins.op_str}')

    def constant(address, expected):
        value = struct.unpack('<f', pe.get_data(address-base, 4))[0]
        if not math.isclose(value, expected, rel_tol=1e-7, abs_tol=1e-9):
            raise AssertionError(f'{address:#x}: {value} != {expected}')

    # Independent instruction checks, not assertions against decompiler text.
    instruction(0x140c3dc8a, 'cmp', 'esi, 4')
    instruction(0x140c3dce8, 'mov', 'dword ptr [rbp + 0x40], 4')
    instruction(0x140c461c7, 'call', '0x140c43b20')
    instruction(0x140c461ce, 'call', '0x140c44010')
    instruction(0x140c46612, 'mov', 'rdx, qword ptr [rax + 8]')
    instruction(0x140c4661f, 'cmp', 'dword ptr [r8 + 0xc], edi')
    instruction(0x140c460cb, 'cmp', 'dword ptr [rdi + 0x58], 0')
    instruction(0x140c460f2, 'call', '0x140c441b0')
    instruction(0x140c460f9, 'call', '0x140c44280')
    instruction(0x140c4450d, 'movd', 'xmm1, dword ptr [rdx + 0x54]')
    instruction(0x140c4460c, 'sub', 'eax, 0x17')
    instruction(0x140c44617, 'cmp', 'eax, 1')
    constant(0x143b2b9d8, 0.01)
    constant(0x143b2b978, 0.005)
    constant(0x141fbc470, 1/99)
    constant(0x143b2d538, 100)

    defaults = extract(path)['tables']['standard']
    return {
        'sha256': EXPECTED_SHA256,
        'validation': 'hash + exact instruction sites + constants; static only',
        'ordinary_effect_slots': 4,
        'release_effect_slot': 4,
        'slot_indexing': 'zero based; release slot is separate from four ordinary slots',
        'same_effect_selection': 'reverse active-list lookup by effect type; newest wins',
        'release_hold_type_zero': 'note-off ignored; press toggles start/stop',
        'release_hold_type_nonzero': 'press starts, release stops',
        'factory_release_hold_types': sorted({r['holdType'] for r in defaults if r['releaseFx']}),
        'parameter_adapter': {
            'level_depth': 'value / 100 (not equivalent to feedback or dry/wet)',
            'room_size': '(value - 1) / 99',
            'pitch_shift': '(value + 100) / 200',
            'color_fx_type_23_or_24': 'value / 100',
            'color_other_types': '(value + 100) / 200',
        },
        'not_verified': ['proprietary DSP response', 'echo-tail lifetime',
                         'brake/backspin rate curves', 'live UI or controller behavior'],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable', type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.executable), indent=2))
