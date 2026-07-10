# -*- coding: utf-8 -*-
import openpyxl, copy
STD = r"c:\claude\sandbox\bisyou\diligence\Bisyou_Impact_Model.xlsx"
BPC = r"c:\claude\sandbox\bisyou\diligence\GE Beauty_BP_v2026__+Bisyou.xlsx"

std = openpyxl.load_workbook(STD)               # the 3 built Bisyou sheets (values)
bp  = openpyxl.load_workbook(BPC)               # the filesystem copy of the BP

before = list(bp.sheetnames)
charts_before = sum(len(getattr(bp[s], "_charts", [])) for s in bp.sheetnames)

# Copy the 3 Bisyou sheets into the BP copy (value + number_format + bold + fill)
for name in ["Bisyou_DRE", "Group_Impact", "Sensitivity"]:
    src = std[name]
    if name in bp.sheetnames:
        del bp[name]
    dst = bp.create_sheet("BISYOU_"+name if name!="Bisyou_DRE" else "Bisyou")
    for row in src.iter_rows():
        for c in row:
            if c.value is None and c.number_format=="General":
                continue
            d = dst.cell(row=c.row, column=c.column, value=c.value)
            d.number_format = c.number_format
            if c.font and c.font.bold: d.font = copy.copy(c.font)
            if c.fill and c.fill.fgColor and c.fill.fgColor.rgb not in (None,"00000000"):
                d.fill = copy.copy(c.fill)
    for col,w in src.column_dimensions.items():
        if w.width: dst.column_dimensions[col].width = w.width

# Add the Bisyou channel flag in Macro (D4=Bisyou, B4=1) mirroring D1:D3 / B1:B3
mac = bp["Macro"]
mac["D4"] = "Bisyou"
mac["B4"] = 1

bp.save(BPC)

# integrity re-check
chk = openpyxl.load_workbook(BPC)
charts_after = sum(len(getattr(chk[s], "_charts", [])) for s in chk.sheetnames)
print("sheets before:", len(before))
print("sheets after :", len(chk.sheetnames), "->", chk.sheetnames[-5:])
print("Macro flags D1:D4 =", [chk["Macro"][f"D{i}"].value for i in (1,2,3,4)],
      "| B1:B4 =", [chk["Macro"][f"B{i}"].value for i in (1,2,3,4)])
print("charts before/after:", charts_before, "/", charts_after)
print("original sheets preserved:", all(s in chk.sheetnames for s in before))
