# Chinese Word Practice Program

I want to learn Chinese. I need a program to practice chinese words. Here's how I imagine the practice flow:

* A database of words is maintained. I want to populate it from publicly available HSK frequency lists, e.g. https://mandarinbean.com/new-hsk-1-word-list/
* When I launch the practicer program, it asks me how many words I want to practice, and I tell it the number.
* I also want to choose the mode of practice. There are several modes:
  * The program shows me the word, and I am supposed to answer with its transliteration (e.g. `shi4`)
  * The program shows me the word, and I am supposed to answer with its English translation (one of)
  * The program shows me the English translation, and I am supposed to answer with the Chinese word (you can assume I have the appropriate keyboard input method set up for that)
* The program selects the specified number of words to practice from the database:
  * This should be based on spaced repetition, where answering correctly moves the word into a "less frequent bucket" (more delay before being asked for again), while answering incorrectly moves it into a "more frequent bucket" (less delay before being asked for again)
  * If, according to the bucket's delay a word should not be practiced yet, the program should include words that have never been practiced, in the order of frequency list, starting from the most frequent.
  * After fetching the words to practice, it should randomly go through all of them and ask the question. The user will be prompted for the answer. If the answer is incorrect, the program notifies the user and shows the correct answer. After the whole round, the program goes again through all the incorrectly answered questions, and so on until all questions have been correctly answered.
* For the above to work, the program needs to maintain some kind of database tracking past answers, in order to determine which words are eligible for given round. This should be maintained independently for every practice mode.
* Preferably, the program should have simple web UI, with a possible option of using it on a mobile device and hand-writing Chinese characters using a stylus.

Give me a detailed implementation plan for the above and save it into a markdown file.
