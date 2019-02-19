Reference implementation files
==============================

We have a javascript implementation of a CRAM decoder, capable of
being run under node.js.

This is not written for speed, but for clarity and as an exercise in
checking the pseudocode in the CRAM specification.  It is written as
close to this pseudocode as is possible.


iostream.js
-----------

Makes a buffer appear to be a stream with ReadByte, ReadITF8, etc
functions.


rans.js
-------

Implements the order-0 and order-1 rans decoder.


main_rans.js
------------

A command line tool to exercise the rans.js code, included for debug
purposes.
