"""Read-only, version-pinned extraction of Pad FX interoperability settings.

Usage: uv run --with pefile --with capstone python THIS_FILE rekordbox.exe
Prints JSON to stdout. Does not execute, install, patch, or redistribute the EXE.
Addresses were traced from the missing-settings branch and XML serializer in
AlphaTheta's signed Windows rekordbox 6.7.0.0072 binary. See the research note.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_MEM, X86_OP_REG, X86_REG_RIP

EXPECTED_SHA256 = '94eabbc22ece732d5d799fbf280f2386bcd8b30348dc303f0f4171c7390dde53'
FIELDS = {
    0: 'fxGroup', 4: 'fxType', 8: 'editableParam',
    0x2c: 'inheritedPadIndex', 0x30: 'numerator', 0x34: 'denominator',
    0x40: 'roomSize', 0x44: 'pitchShift', 0x48: 'color',
    0x4c: 'leveldepth', 0x50: 'holdType', 0x54: 'colorTableIndex',
}


def extract(path):
    raw = Path(path).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError('Unsupported binary hash; refusing to apply version-specific addresses')
    pe = pefile.PE(data=raw)
    base = pe.OPTIONAL_HEADER.ImageBase
    if base != 0x140000000:
        raise ValueError('Unexpected image base')
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    md.detail = True
    names = {}
    # Read the string-construction arguments statically. No target code runs.
    for start, length, table, type_start, count in (
        (0x1402019b0, 0x261, 0x1442f9930, 0, 29),
        (0x140201870, 0x59, 0x1442f98d0, 29, 3),
    ):
        string_address = None
        for ins in md.disasm(pe.get_data(start-base, length), start):
            if ins.mnemonic != 'lea' or len(ins.operands) != 2:
                continue
            dst, src = ins.operands
            if dst.type != X86_OP_REG or src.type != X86_OP_MEM or src.mem.base != X86_REG_RIP:
                continue
            address = ins.address + ins.size + src.mem.disp
            register = ins.reg_name(dst.reg)
            if register == 'rdx':
                string_address = address
            elif register == 'rcx' and table <= address < table+count*8:
                assert string_address is not None and (address-table) % 8 == 0
                effect_id = type_start + (address-table)//8
                names[effect_id] = pe.get_data(string_address-base,64).split(b'\0')[0].decode('ascii')
    assert len(names) == 32
    result = {'version': '6.7.0.0072', 'sha256': digest,
              'validation': 'static missing-settings tables; not a live UI/audio test', 'tables': {}}
    for label, address in (('standard', 0x1441faee0), ('_bg', 0x1441fb9e0)):
        rows = []
        for i in range(32):
            data = pe.get_data(address-base+i*0x58, 0x58)
            row = {'bank': i//16+1, 'slot': i%16+1}
            row.update({name: struct.unpack_from('<i',data,offset)[0] for offset,name in FIELDS.items()})
            row['effect'] = names[row['fxType']]
            row['releaseFx'] = row['fxGroup'] == 3
            assert row['fxGroup'] in range(4)
            assert row['holdType'] in (0,1,2)
            rows.append(row)
        result['tables'][label] = rows
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable', type=Path)
    args = parser.parse_args()
    print(json.dumps(extract(args.executable), indent=2))
