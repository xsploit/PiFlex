// Read-only, version-pinned Rekordbox interoperability research.
// Run with analyzeHeadless -noanalysis -postScript InspectPadFx.java OUTPUT VA...
// OUTPUT must be outside the source repository. Decompiled output is local
// research evidence, not code to copy into BiteDJ or redistribute.
// @category Research
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.SourceType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class InspectPadFx extends GhidraScript {
    private static final String HASH = "94eabbc22ece732d5d799fbf280f2386bcd8b30348dc303f0f4171c7390dde53";
    private final List<long[]> ranges = new ArrayList<>();

    private Function ensureFunction(Address address) throws Exception {
        Function existing = getFunctionAt(address);
        if (existing != null) return existing;
        for (long[] range : ranges) {
            if (address.getOffset() != range[0]) continue;
            disassemble(address);
            return currentProgram.getFunctionManager().createFunction(
                "FUN_" + address.toString(), address,
                new AddressSet(address, toAddr(range[1] - 1)), SourceType.ANALYSIS);
        }
        // Windows x64 leaf functions can legitimately have no .pdata record.
        // Addresses supplied by the caller must come from independently traced
        // call/vtable targets; only create them in executable memory.
        MemoryBlock block = currentProgram.getMemory().getBlock(address);
        if (block == null || !block.isExecute()) return null;
        disassemble(address);
        return createFunction(address, "FUN_" + address.toString());
    }

    public void run() throws Exception {
        if (!HASH.equalsIgnoreCase(currentProgram.getExecutableSHA256()))
            throw new IllegalArgumentException("Unsupported binary hash; refusing fixed-address analysis");
        String[] args = getScriptArgs();
        if (args.length < 2) throw new IllegalArgumentException("Expected output directory and hex virtual addresses");
        Path out = Path.of(args[0]).toAbsolutePath();
        Files.createDirectories(out);
        MemoryBlock pdata = currentProgram.getMemory().getBlock(".pdata");
        if (pdata == null) throw new IllegalStateException("No PE exception directory");
        long base = currentProgram.getImageBase().getOffset();
        for (long offset = 0; offset + 12 <= pdata.getSize(); offset += 12) {
            Address entry = pdata.getStart().add(offset);
            long start = Integer.toUnsignedLong(getInt(entry));
            long end = Integer.toUnsignedLong(getInt(entry.add(4)));
            if (end > start) ranges.add(new long[] {base + start, base + end});
        }
        List<Function> selected = new ArrayList<>();
        for (int i = 1; i < args.length; i++) {
            Function fn = ensureFunction(toAddr(Long.decode(args[i])));
            if (fn == null) throw new IllegalArgumentException("Cannot create function at: " + args[i]);
            selected.add(fn);
        }
        // Give the decompiler direct callees proper function boundaries too.
        for (Function fn : selected) {
            var insns = currentProgram.getListing().getInstructions(fn.getBody(), true);
            while (insns.hasNext()) {
                Instruction ins = insns.next();
                if (!ins.getFlowType().isCall()) continue;
                for (Address target : ins.getFlows()) ensureFunction(target);
            }
        }
        DecompInterface decompiler = new DecompInterface();
        try {
            if (!decompiler.openProgram(currentProgram))
                throw new IllegalStateException(decompiler.getLastMessage());
            for (Function fn : selected) {
                monitor.checkCancelled();
                DecompileResults result = decompiler.decompileFunction(fn, 45, monitor);
                if (!result.decompileCompleted())
                    throw new IllegalStateException(fn + ": " + result.getErrorMessage());
                String name = fn.getEntryPoint().toString();
                Files.writeString(out.resolve(name + ".c"), result.getDecompiledFunction().getC(), StandardCharsets.UTF_8);
                println("DECOMPILED " + name + " -> " + out);
            }
        } finally { decompiler.dispose(); }
    }
}
