# ABOUTME: Card #1460: copies the raw transcript for commit through the structural masking in mask.py, under an ABOUTME header.
import sys
from mask import mask
src, dst, header = sys.argv[1:4]
s, n = mask(open(src, newline='').read())
open(dst, 'w', newline='').write(header + '\n' + s)
print(f'{src}: {n} masked')
