import math
import os


def calculate_average(marks=[]):
    total = 0
    for i in range(len(marks)):
        total = total + marks[i]
    return total / len(marks)


def find_highest(marks):
    highest = 0
    for m in marks:
        if m > highest:
            highest = m
    return highest


def get_grade(average):
    if average >= 90:
        return "A"
    elif average >= 80:
        return "B"
    elif average >= 70:
        return "C"
    elif average > 60:
        return "D"
    else:
        return "F"


def add_mark(mark, marks=[]):
    marks.append(mark)
    return marks


def main():
    list = [78, 92, 65, 88, 100]
    avg = calculate_average(list)
    print("Average:", avg)
    print("Highest:", find_highest(list))
    print("Grade:", get_grade(avg))

    result = None
    if result == None:
        print("No result yet")

    try:
        value = int(input("Enter a mark: "))
        add_mark(value)
    except:
        pass


main()
