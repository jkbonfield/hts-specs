// Name tokeniser
//
// This is a reference implementation designed to match the
// written specification as closely as possible.  It is *NOT*
// an efficient implementation, but see comments below.

const IOStream  = require("./iostream");
const rans      = require("./rans4x16");
const arith_gen = require("./arith_gen");

var arith = new arith_gen()

const TOK_TYPE    = 0
const TOK_STRING  = 1
const TOK_CHAR    = 2
const TOK_DIGITS0 = 3
const TOK_DZLEN   = 4
const TOK_DUP     = 5
const TOK_DIFF    = 6
const TOK_DIGITS  = 7
const TOK_DELTA   = 8
const TOK_DELTA0  = 9
const TOK_MATCH   = 10
const TOK_NOP     = 11
const TOK_END     = 12

//----------------------------------------------------------------------
// Token byte streams
function DecodeTokenByteStreams(src, in_size, use_arith, nnames) {
    var t = -1

    var B = new Array(256)

    while (!src.EOF()) {
	var ttype = src.ReadByte()
	var tok_new = ttype & 128
	var tok_dup = ttype & 64
	var type    = ttype & 63

	if (tok_new) {
	    t++
	    B[t] = new Array(13)
	}

	if (type != TOK_TYPE && tok_new) {
	    var M = new Array(nnames-1).fill(TOK_MATCH)
	    B[t][TOK_TYPE] = new IOStream(Buffer.from([type].concat(M)))
        }

	if (tok_dup) {
	    var dup_pos  = src.ReadByte()
	    var dup_type = src.ReadByte()
	    B[t][type] = new IOStream(B[dup_pos][dup_type].buf)
	} else {
	    var clen = src.ReadUint7()
	    var data = src.ReadData(clen)

	    if (use_arith)
		B[t][type] = arith.decode(data)
	    else
		B[t][type] = rans.decode(data)
	    B[t][type] = new IOStream(B[t][type])
	}
    }


    return B
}

//----------------------------------------------------------------------
// Token decode
function LeftPadNumber(val, len) {
    var str = val+""
    while (str.length < len)
	str = "0" + str

    return str
}

function DecodeSingleName(B, N, T, n) {
    var type = B[0][TOK_TYPE].ReadByte()
    var dist = B[0][type].ReadUint32()
    var m = n - dist

    if (type == TOK_DUP) {
	N[n] = N[m]
	T[n] = T[m]
	return N[n]
    }
    
    var t = 1
    N[n] = ""
    T[n] = new Array(256)
    do {
	type = B[t][TOK_TYPE].ReadByte()

	switch(type) {
	case TOK_CHAR:
	    T[n][t] = B[t][TOK_CHAR].ReadChar()
	    break

	case TOK_STRING:
	    T[n][t] = B[t][TOK_STRING].ReadString()
	    break
	
	case TOK_DIGITS:
	    T[n][t] = B[t][TOK_DIGITS].ReadUint32()
	    break

	case TOK_DIGITS0:
	    var d = B[t][TOK_DIGITS0].ReadUint32()
	    var l = B[t][TOK_DZLEN].ReadByte()
	    T[n][t] = LeftPadNumber(d, l)
	    break

	case TOK_DELTA:
	    T[n][t] = (T[m][t]>>0) + B[t][TOK_DELTA].ReadByte()
	    break

	case TOK_DELTA0:
	    var d = (T[m][t]>>0) + B[t][TOK_DELTA0].ReadByte()
	    var l = T[m][t].length
	    T[n][t] = LeftPadNumber(d, l)
	    break

	case TOK_MATCH:
	    T[n][t] = T[m][t]
	    break

	default:
	    T[n][t] = ""
	    break
	}

	N[n] += T[n][t++]
    } while (type != TOK_END)

    return N[n]
}

//----------------------------------------------------------------------
// Main rANS entry function: decodes a compressed src and
// returns the uncompressed buffer.
function decode(src, len) {
    var src = new IOStream(src)
    var ulen = src.ReadUint32()
    var nnames = src.ReadUint32()
    var use_arith = src.ReadByte()

    var B = DecodeTokenByteStreams(src, len, use_arith, nnames)
    var N = new Array(nnames)
    var T = new Array(nnames)

    var str = ""
    for (var i = 0; i < nnames; i++)
	str += DecodeSingleName(B, N, T, i) + "\n"

    return str
}

module.exports = { decode }
