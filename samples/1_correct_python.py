"""Student marks statistics - a clean, well-structured Python program."""

from statistics import mean


def read_marks(raw_text: str) -> list[int]:
    """Convert a comma-separated string such as "78, 92, 65" into a list of marks."""
    marks = []
    for part in raw_text.split(","):
        part = part.strip()
        if not part:
            continue
        value = int(part)
        if not 0 <= value <= 100:
            raise ValueError(f"Mark {value} is outside the range 0-100")
        marks.append(value)
    return marks


def grade_for(average: float) -> str:
    """Return the letter grade for an average mark."""
    boundaries = [(90, "A"), (80, "B"), (70, "C"), (60, "D")]
    for minimum, grade in boundaries:
        if average >= minimum:
            return grade
    return "F"


def summarize(marks: list[int]) -> dict:
    """Compute the statistics shown to the user."""
    if not marks:
        raise ValueError("At least one mark is required")
    average = mean(marks)
    return {
        "count": len(marks),
        "average": round(average, 2),
        "highest": max(marks),
        "lowest": min(marks),
        "grade": grade_for(average),
    }


def main() -> None:
    raw_text = input("Enter marks separated by commas: ")
    try:
        stats = summarize(read_marks(raw_text))
    except ValueError as error:
        print(f"Invalid input: {error}")
        return

    for key, value in stats.items():
        print(f"{key.capitalize():>8}: {value}")


if __name__ == "__main__":
    main()
